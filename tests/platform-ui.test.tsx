import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AnalyticsSummary } from '../src/shared/types';

const api = vi.hoisted(() => vi.fn());
vi.mock('../src/client/api', () => ({ api }));

import { Dashboard } from '../src/client/Dashboard';
import { Projects } from '../src/client/Projects';
import { ChatAttachments } from '../src/client/ChatAttachments';

const text = (node: unknown): string =>
  typeof node === 'string'
    ? node
    : typeof node === 'number'
      ? String(node)
      : Array.isArray(node)
        ? node.map(text).join('')
        : node && typeof node === 'object' && 'children' in node
          ? text((node as { children: unknown }).children)
          : '';

beforeEach(() => {
  api.mockReset();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

function summary(): AnalyticsSummary {
  return {
    generatedAt: Date.now(),
    usage: {
      conversations: 3,
      agentRuns: 12,
      pages: 4,
      calls: 1,
      taskRuns: 2,
      projects: 1,
      attachments: 2,
    },
    taskStats: {
      queued: 1,
      running: 0,
      paused: 0,
      completed: 5,
      failed: 1,
      interrupted: 0,
      cancelled: 0,
      total: 7,
    },
    performance: {
      avgAgentRunMs: 2400,
      p50AgentRunMs: 2000,
      p95AgentRunMs: 5000,
      successRate: 0.916,
      busiestHour: 14,
    },
    agentActivity: [
      {
        dotId: 'dot-1',
        name: 'Scout',
        runs: 12,
        successes: 11,
        failures: 1,
        avgDurationMs: 2400,
        lastAt: Date.now() - 60_000,
      },
    ],
    daily: Array.from({ length: 14 }, (_, index) => ({
      date: `2026-01-${String(index + 1).padStart(2, '0')}`,
      agentRuns: index,
      pages: 0,
      conversations: 0,
      calls: 0,
      taskRuns: 0,
      projects: 0,
    })),
    recent: [
      {
        id: 1,
        at: Date.now() - 30_000,
        kind: 'agent_run',
        dotId: 'dot-1',
        threadId: 'thread-1',
        refId: null,
        durationMs: 1200,
        ok: true,
        meta: {},
      },
    ],
  };
}

it('renders dashboard usage, performance and agent activity', async () => {
  api.mockImplementation(async (path: string) =>
    path === '/analytics' ? summary() : null,
  );
  let root!: ReturnType<typeof create>;
  await act(async () => {
    root = create(
      createElement(Dashboard, { dots: [{ id: 'dot-1', name: 'Scout' }] }),
    );
  });
  const view = text(root.toJSON());
  expect(view).toContain('12');
  expect(view).toContain('2.4 s');
  expect(view).toContain('92% completed');
  expect(view).toContain('Scout');
  expect(view).toContain('14:00');
  await act(async () => root.unmount());
});

it('surfaces a dashboard failure with a retry', async () => {
  api.mockRejectedValue(new Error('Server offline'));
  let root!: ReturnType<typeof create>;
  await act(async () => {
    root = create(createElement(Dashboard, { dots: [] }));
  });
  expect(text(root.toJSON())).toContain('could not load');
  await act(async () => root.unmount());
});

it('opens a project and shows its files and download link', async () => {
  api.mockImplementation(async (path: string) => {
    if (path === '/projects')
      return [
        {
          id: 'p1',
          dotId: 'dot-1',
          name: 'Portfolio',
          description: '',
          template: 'static',
          status: 'ready',
          fileCount: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ];
    if (path === '/projects/p1')
      return {
        id: 'p1',
        dotId: 'dot-1',
        name: 'Portfolio',
        description: '',
        template: 'static',
        status: 'ready',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        files: [{ path: 'index.html', content: '<h1>Portfolio</h1>' }],
      };
    return null;
  });
  let root!: ReturnType<typeof create>;
  await act(async () => {
    root = create(
      createElement(Projects, {
        dots: [{ id: 'dot-1', name: 'Scout' }],
        onError: vi.fn(),
      }),
    );
  });
  const open = root.root.findByProps({ 'aria-label': 'Open Portfolio' });
  await act(async () => open.props.onClick());
  const view = text(root.toJSON());
  expect(view).toContain('index.html');
  expect(view).toContain('Download ZIP');
  const download = root.root.findAll(
    (node) =>
      node.type === 'button' &&
      text(node.props.children).includes('Download ZIP'),
  );
  expect(download.length).toBeGreaterThan(0);
  await act(async () => root.unmount());
});

it('lists conversation documents and attaches a file as base64', async () => {
  api.mockImplementation(async (path: string, method = 'GET') => {
    if (path.endsWith('/attachments') && method === 'GET') return [];
    if (path.endsWith('/attachments') && method === 'POST')
      return {
        id: 'a1',
        threadId: 'thread-1',
        name: 'notes.txt',
        kind: 'text',
        mimeType: 'text/plain',
        size: 5,
        createdAt: Date.now(),
        text: 'hello',
      };
    return null;
  });
  const onError = vi.fn();
  let root!: ReturnType<typeof create>;
  await act(async () => {
    root = create(
      createElement(ChatAttachments, {
        threadId: 'thread-1',
        onError,
      }),
    );
  });
  const toggle = root.root.findByProps({
    'aria-label': 'Documents for this conversation',
  });
  await act(async () => toggle.props.onClick());
  expect(api).toHaveBeenCalledWith('/conversations/thread-1/attachments');

  const input = root.root.findByProps({ type: 'file' });
  const file = {
    name: 'notes.txt',
    size: 5,
    type: 'text/plain',
    arrayBuffer: async () => new Uint8Array([104, 101, 108, 108, 111]).buffer,
  };
  await act(async () => input.props.onChange({ target: { files: [file] } }));
  const post = api.mock.calls.find((call) => call[1] === 'POST');
  expect(post?.[0]).toBe('/conversations/thread-1/attachments');
  expect((post?.[2] as { content: string }).content).toBe('aGVsbG8=');
  expect(text(root.toJSON())).toContain('notes.txt');
  expect(onError).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});

it('fills the MCP form from a connection preset', async () => {
  api.mockImplementation(async (path: string) =>
    path.endsWith('/connections') ? [] : null,
  );
  const { ConnectionsSection } =
    await import('../src/client/ConnectionsSection');
  let root!: ReturnType<typeof create>;
  await act(async () => {
    root = create(createElement(ConnectionsSection, { dotId: 'dot-1' }));
  });
  const preset = root.root.findAll(
    (node) => node.type === 'button' && node.props.className === 'preset-chip',
  )[1];
  await act(async () => preset.props.onClick());
  const inputs = root.root.findAll((node) => node.type === 'input');
  expect(inputs[0].props.value).toBe('Linear');
  expect(inputs[1].props.value).toBe('https://mcp.linear.app/mcp');
  await act(async () => root.unmount());
});
