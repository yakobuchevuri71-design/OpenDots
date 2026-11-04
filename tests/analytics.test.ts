import { describe, expect, it } from 'vitest';
import { AnalyticsStore } from '../src/server/analytics.js';
import { DatabaseSync } from 'node:sqlite';

function fixture() {
  return new AnalyticsStore(new DatabaseSync(':memory:'));
}

describe('local usage analytics', () => {
  it('records and reads back events newest first', () => {
    const analytics = fixture();
    analytics.record({ kind: 'agent_run', dotId: 'dot-1', ok: true, at: 1 });
    analytics.record({ kind: 'page_created', refId: 'page-1', at: 2 });
    const events = analytics.events();
    expect(events.map((event) => event.kind)).toEqual([
      'page_created',
      'agent_run',
    ]);
    expect(events[1]).toMatchObject({ dotId: 'dot-1', ok: true });
  });

  it('summarizes usage, latency percentiles and success rate', () => {
    const analytics = fixture();
    for (const [index, duration] of [100, 200, 300, 400].entries())
      analytics.record({
        kind: 'agent_run',
        dotId: 'dot-1',
        durationMs: duration,
        ok: index !== 3,
      });
    analytics.record({ kind: 'conversation_created', dotId: 'dot-1' });
    analytics.record({ kind: 'project_created', dotId: 'dot-2' });
    const summary = analytics.summary(new Map([['dot-1', 'Scout']]));
    expect(summary.usage).toMatchObject({
      conversations: 1,
      agentRuns: 4,
      projects: 1,
    });
    expect(summary.performance.avgAgentRunMs).toBe(250);
    expect(summary.performance.successRate).toBeCloseTo(0.75);
    expect(summary.agentActivity[0]).toMatchObject({
      dotId: 'dot-1',
      name: 'Scout',
      runs: 4,
      successes: 3,
      failures: 1,
      avgDurationMs: 250,
    });
  });

  it('buckets daily activity across a 14 day window including today', () => {
    const analytics = fixture();
    const today = new Date();
    const bucket = analytics.summary(new Map()).daily;
    expect(bucket).toHaveLength(14);
    expect(bucket.at(-1)?.date).toBe(today.toISOString().slice(0, 10));
    analytics.record({ kind: 'agent_run', at: Date.now() });
    analytics.record({ kind: 'agent_run', at: Date.now() });
    expect(analytics.summary(new Map()).daily.at(-1)?.agentRuns).toBe(2);
  });

  it('leaves task statistics for the caller to fill from the task store', () => {
    const analytics = fixture();
    const summary = analytics.summary(new Map());
    expect(summary.taskStats.total).toBe(0);
    expect(summary.taskStats.queued).toBe(0);
  });
});
