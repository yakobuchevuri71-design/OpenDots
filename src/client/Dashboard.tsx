import { useEffect, useState } from 'react';
import {
  Activity,
  Clock3,
  FileText,
  Folder,
  MessageCircle,
  Phone,
  RefreshCw,
  Timer,
  Zap,
} from 'lucide-react';
import type { AnalyticsEvent, AnalyticsSummary } from '../shared/types';
import { api } from './api';
import { AreaChart, BarList, DonutChart, StatCard } from './charts';

const STATUS_COLORS: Record<string, string> = {
  completed: '#5f9e7d',
  running: '#7285d5',
  queued: '#b9a24a',
  paused: '#9b9ba6',
  failed: '#c0605a',
  interrupted: '#b07f4e',
  cancelled: '#9b9ba6',
};

const EVENT_LABELS: Record<AnalyticsEvent['kind'], string> = {
  conversation_created: 'Conversation started',
  agent_run: 'Dot turn',
  page_created: 'Page created',
  task_run: 'Scheduled task ran',
  call: 'Voice call',
  project_created: 'Project generated',
  attachment_added: 'Document attached',
};

function formatDuration(ms: number) {
  if (!ms) return '—';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

function relative(at: number) {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

export function Dashboard({ dots }: { dots: { id: string; name: string }[] }) {
  const [summary, setSummary] = useState<AnalyticsSummary>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setSummary(await api<AnalyticsSummary>('/analytics'));
      setError('');
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not load the dashboard.',
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, []);

  if (error && !summary)
    return (
      <div className="large-empty">
        <Activity size={32} />
        <h2>The dashboard could not load.</h2>
        <p>{error}</p>
        <button className="primary" onClick={() => void load()}>
          Retry
        </button>
      </div>
    );

  if (!summary)
    return (
      <div className="large-empty">
        <Activity size={32} />
        <h2>Gathering your activity…</h2>
      </div>
    );

  const { usage, performance, taskStats, agentActivity, daily } = summary;
  const totalActivity =
    usage.agentRuns +
    usage.pages +
    usage.conversations +
    usage.calls +
    usage.taskRuns +
    usage.projects;
  const statusSegments = Object.entries(taskStats)
    .filter(([key]) => key !== 'total')
    .map(([key, value]) => ({
      label: key,
      value,
      color: STATUS_COLORS[key] ?? '#9b9ba6',
    }))
    .filter((segment) => segment.value > 0);

  return (
    <div className="dashboard">
      <div className="dashboard-toolbar">
        <span className="muted">
          Local usage from this deployment. Updated{' '}
          {relative(summary.generatedAt)}.
        </span>
        <button
          className="icon-button"
          aria-label="Refresh dashboard"
          disabled={loading}
          onClick={() => void load()}
        >
          <RefreshCw size={16} className={loading ? 'spin' : undefined} />
        </button>
      </div>

      <section className="stat-grid">
        <StatCard
          label="Dot turns"
          value={usage.agentRuns}
          hint={`${Math.round(performance.successRate * 100)}% completed`}
          icon={<Zap size={15} />}
        />
        <StatCard
          label="Conversations"
          value={usage.conversations}
          hint={`${usage.attachments} documents attached`}
          icon={<MessageCircle size={15} />}
        />
        <StatCard
          label="Pages"
          value={usage.pages}
          hint={`${usage.projects} projects generated`}
          icon={<FileText size={15} />}
        />
        <StatCard
          label="Calls"
          value={usage.calls}
          hint={`${usage.taskRuns} scheduled runs`}
          icon={<Phone size={15} />}
        />
      </section>

      <section className="chart-grid">
        <AreaChart
          label="Daily activity"
          points={daily.map((day) => ({
            label: day.date,
            value:
              day.agentRuns +
              day.pages +
              day.conversations +
              day.calls +
              day.taskRuns +
              day.projects,
          }))}
        />
        <DonutChart
          label="Task status"
          total={taskStats.total}
          segments={statusSegments}
        />
      </section>

      <section className="chart-grid">
        <BarList
          label="Activity by type"
          items={[
            { label: 'Dot turns', value: usage.agentRuns, color: '#7285d5' },
            { label: 'Pages', value: usage.pages, color: '#5f9e7d' },
            {
              label: 'Conversations',
              value: usage.conversations,
              color: '#b9a24a',
            },
            { label: 'Calls', value: usage.calls, color: '#a173c9' },
            { label: 'Tasks', value: usage.taskRuns, color: '#c0605a' },
            { label: 'Projects', value: usage.projects, color: '#4f9ea8' },
          ]}
        />
        <figure className="chart">
          <figcaption>Performance</figcaption>
          <ul className="perf-list">
            <li>
              <Timer size={15} />
              <span>Average turn</span>
              <strong>{formatDuration(performance.avgAgentRunMs)}</strong>
            </li>
            <li>
              <Clock3 size={15} />
              <span>Median turn (p50)</span>
              <strong>{formatDuration(performance.p50AgentRunMs)}</strong>
            </li>
            <li>
              <Activity size={15} />
              <span>Slowest 5% (p95)</span>
              <strong>{formatDuration(performance.p95AgentRunMs)}</strong>
            </li>
            <li>
              <Folder size={15} />
              <span>Busiest hour (UTC)</span>
              <strong>
                {performance.busiestHour === null
                  ? '—'
                  : `${String(performance.busiestHour).padStart(2, '0')}:00`}
              </strong>
            </li>
          </ul>
        </figure>
      </section>

      <section className="chart-grid">
        <figure className="chart">
          <figcaption>Agent activity</figcaption>
          {agentActivity.length ? (
            <table className="agent-table">
              <thead>
                <tr>
                  <th>Dot</th>
                  <th>Turns</th>
                  <th>Success</th>
                  <th>Avg</th>
                  <th>Last active</th>
                </tr>
              </thead>
              <tbody>
                {agentActivity.map((agent) => (
                  <tr key={agent.dotId}>
                    <td>{agent.name}</td>
                    <td>{agent.runs}</td>
                    <td>
                      {agent.runs
                        ? `${Math.round((agent.successes / agent.runs) * 100)}%`
                        : '—'}
                    </td>
                    <td>{formatDuration(agent.avgDurationMs)}</td>
                    <td>{agent.lastAt ? relative(agent.lastAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">
              Dot turns appear here once you start chatting.
            </p>
          )}
        </figure>
        <figure className="chart">
          <figcaption>Recent activity</figcaption>
          {summary.recent.length ? (
            <ul className="activity-feed">
              {summary.recent.slice(0, 12).map((event) => (
                <li key={`${event.kind}-${event.id}-${event.at}`}>
                  <i
                    style={{
                      background: STATUS_COLORS[event.kind] ?? '#7285d5',
                    }}
                  />
                  <span>{EVENT_LABELS[event.kind] ?? event.kind}</span>
                  <small>
                    {dots.find((dot) => dot.id === event.dotId)?.name ?? ''}{' '}
                    {relative(event.at)}
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              Activity from conversations, pages and tasks shows up here.
            </p>
          )}
        </figure>
      </section>

      <p className="dashboard-footnote muted">
        {totalActivity
          ? `${totalActivity} recorded actions. Metrics stay in this deployment's database.`
          : 'Nothing recorded yet. Start a conversation to see metrics.'}
      </p>
    </div>
  );
}
