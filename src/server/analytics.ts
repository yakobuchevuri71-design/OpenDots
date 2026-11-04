import type { DatabaseSync } from 'node:sqlite';
import type {
  AgentActivity,
  AnalyticsEvent,
  AnalyticsEventKind,
  AnalyticsSummary,
  DailyActivity,
} from '../shared/types.js';

export interface RecordInput {
  kind: AnalyticsEventKind;
  dotId?: string | null;
  threadId?: string | null;
  refId?: string | null;
  durationMs?: number | null;
  ok?: boolean;
  meta?: Record<string, unknown>;
  at?: number;
}

const DAILY_WINDOW_DAYS = 14;
const RECENT_LIMIT = 25;

function utcDate(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

function percentile(sorted: number[], fraction: number): number {
  if (!sorted.length) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round(fraction * (sorted.length - 1))),
  );
  return sorted[index];
}

// Local, provider-free usage analytics. Every row is written by the server from
// its own records; nothing here leaves the machine.
export class AnalyticsStore {
  constructor(private db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS analytics_events(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      kind TEXT NOT NULL,
      dotId TEXT,
      threadId TEXT,
      refId TEXT,
      durationMs INTEGER,
      ok INTEGER NOT NULL DEFAULT 1,
      meta TEXT NOT NULL DEFAULT '{}');
      CREATE INDEX IF NOT EXISTS analytics_kind_at ON analytics_events(kind, at);
      CREATE INDEX IF NOT EXISTS analytics_dot ON analytics_events(dotId, at);`);
  }

  record(input: RecordInput): AnalyticsEvent {
    const at = input.at ?? Date.now();
    const ok = input.ok === false ? 0 : 1;
    const durationMs =
      typeof input.durationMs === 'number' && Number.isFinite(input.durationMs)
        ? Math.max(0, Math.round(input.durationMs))
        : null;
    const meta = JSON.stringify(input.meta ?? {});
    this.db
      .prepare(
        'INSERT INTO analytics_events(at, kind, dotId, threadId, refId, durationMs, ok, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        at,
        input.kind,
        input.dotId ?? null,
        input.threadId ?? null,
        input.refId ?? null,
        durationMs,
        ok,
        meta,
      );
    return {
      id: 0,
      at,
      kind: input.kind,
      dotId: input.dotId ?? null,
      threadId: input.threadId ?? null,
      refId: input.refId ?? null,
      durationMs,
      ok: ok === 1,
      meta: input.meta ?? {},
    };
  }

  events(limit = RECENT_LIMIT): AnalyticsEvent[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM analytics_events ORDER BY at DESC, id DESC LIMIT ?',
      )
      .all(Math.max(1, Math.min(500, limit))) as unknown as {
      id: number;
      at: number;
      kind: string;
      dotId: string | null;
      threadId: string | null;
      refId: string | null;
      durationMs: number | null;
      ok: number;
      meta: string;
    }[];
    return rows.map((row) => ({
      id: row.id,
      at: row.at,
      kind: row.kind as AnalyticsEventKind,
      dotId: row.dotId,
      threadId: row.threadId,
      refId: row.refId,
      durationMs: row.durationMs,
      ok: !!row.ok,
      meta: safeParse(row.meta),
    }));
  }

  count(kind: AnalyticsEventKind): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM analytics_events WHERE kind=?')
      .get(kind) as { n: number } | undefined;
    return row?.n ?? 0;
  }

  private rowsSince(since: number) {
    return this.db
      .prepare(
        'SELECT kind, dotId, durationMs, ok, at FROM analytics_events WHERE at >= ?',
      )
      .all(since) as unknown as {
      kind: string;
      dotId: string | null;
      durationMs: number | null;
      ok: number;
      at: number;
    }[];
  }

  summary(dotNames: Map<string, string>): AnalyticsSummary {
    const now = Date.now();
    const since = now - DAILY_WINDOW_DAYS * 86_400_000;
    const rows = this.rowsSince(since);
    const allAgentRuns = this.db
      .prepare(
        "SELECT dotId, durationMs, ok, at FROM analytics_events WHERE kind='agent_run'",
      )
      .all() as unknown as {
      dotId: string | null;
      durationMs: number | null;
      ok: number;
      at: number;
    }[];

    const byDot = new Map<
      string,
      { runs: number; successes: number; durations: number[]; lastAt: number }
    >();
    for (const row of allAgentRuns) {
      const key = row.dotId ?? 'unassigned';
      const entry = byDot.get(key) ?? {
        runs: 0,
        successes: 0,
        durations: [],
        lastAt: 0,
      };
      entry.runs += 1;
      if (row.ok) entry.successes += 1;
      if (typeof row.durationMs === 'number')
        entry.durations.push(row.durationMs);
      entry.lastAt = Math.max(entry.lastAt, row.at);
      byDot.set(key, entry);
    }
    const agentActivity: AgentActivity[] = [...byDot.entries()]
      .map(([dotId, entry]) => ({
        dotId,
        name: dotNames.get(dotId) ?? 'Unassigned',
        runs: entry.runs,
        successes: entry.successes,
        failures: entry.runs - entry.successes,
        avgDurationMs: entry.durations.length
          ? Math.round(
              entry.durations.reduce((sum, value) => sum + value, 0) /
                entry.durations.length,
            )
          : 0,
        lastAt: entry.lastAt || null,
      }))
      .sort((a, b) => b.runs - a.runs);

    const daily: DailyActivity[] = [];
    const buckets = new Map<string, DailyActivity>();
    for (let offset = DAILY_WINDOW_DAYS - 1; offset >= 0; offset -= 1) {
      const date = utcDate(now - offset * 86_400_000);
      const bucket: DailyActivity = {
        date,
        agentRuns: 0,
        pages: 0,
        conversations: 0,
        calls: 0,
        taskRuns: 0,
        projects: 0,
      };
      buckets.set(date, bucket);
      daily.push(bucket);
    }
    const bump = (kind: string, date: string) => {
      const bucket = buckets.get(date);
      if (!bucket) return;
      if (kind === 'agent_run') bucket.agentRuns += 1;
      else if (kind === 'page_created') bucket.pages += 1;
      else if (kind === 'conversation_created') bucket.conversations += 1;
      else if (kind === 'call') bucket.calls += 1;
      else if (kind === 'task_run') bucket.taskRuns += 1;
      else if (kind === 'project_created') bucket.projects += 1;
    };
    const hourCounts = new Array(24).fill(0) as number[];
    for (const row of rows) {
      bump(row.kind, utcDate(row.at));
      if (row.kind === 'agent_run')
        hourCounts[new Date(row.at).getUTCHours()] += 1;
    }

    const durations = allAgentRuns
      .map((row) => row.durationMs)
      .filter((value): value is number => typeof value === 'number')
      .sort((a, b) => a - b);
    const successes = allAgentRuns.filter((row) => row.ok).length;
    const busiestHour = hourCounts.some((count) => count > 0)
      ? hourCounts.indexOf(Math.max(...hourCounts))
      : null;

    return {
      generatedAt: now,
      usage: {
        conversations: this.count('conversation_created'),
        agentRuns: this.count('agent_run'),
        pages: this.count('page_created'),
        calls: this.count('call'),
        taskRuns: this.count('task_run'),
        projects: this.count('project_created'),
        attachments: this.count('attachment_added'),
      },
      taskStats: {
        queued: 0,
        running: 0,
        completed: 0,
        failed: 0,
        interrupted: 0,
        cancelled: 0,
        paused: 0,
        total: 0,
      },
      performance: {
        avgAgentRunMs: durations.length
          ? Math.round(
              durations.reduce((sum, value) => sum + value, 0) /
                durations.length,
            )
          : 0,
        p50AgentRunMs: percentile(durations, 0.5),
        p95AgentRunMs: percentile(durations, 0.95),
        successRate: allAgentRuns.length ? successes / allAgentRuns.length : 0,
        busiestHour,
      },
      agentActivity,
      daily,
      recent: this.events(RECENT_LIMIT),
    };
  }
}

function safeParse(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
