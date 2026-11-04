import { afterEach, expect, it } from 'vitest';
import { Store } from '../src/server/store.js';
import { WorkspaceStore } from '../src/server/workspace.js';
import { Platform } from '../src/server/platform.js';
import { Runner } from '../src/server/runner.js';
import { createApp } from '../src/server/app.js';

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((fn) => fn()));

function fixture() {
  const store = new Store(':memory:');
  const ws = new WorkspaceStore(':memory:', 'owner');
  cleanup.push(() => {
    store.close();
    ws.close();
  });
  const config = {
    mode: 'live' as const,
    baseUrl: 'https://example.com',
    model: 'gpt-4o-mini',
  };
  const platform = new Platform(store, ws, {
    baseUrl: config.baseUrl,
    model: config.model,
    voiceName: 'marin',
    slackUsers: [],
    runtimeUrl: '',
  });
  return {
    ws,
    app: createApp({
      store,
      runner: new Runner(store, config),
      config,
      platform,
    }),
  };
}

const json = (body: unknown, method = 'POST') => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

it('serves the model catalogue with the deployment default', async () => {
  const { app } = fixture();
  const response = await app.request('/api/models');
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    catalog: unknown[];
    default: string;
  };
  expect(body.catalog.length).toBeGreaterThan(0);
  expect(body.default).toBe('gpt-4o-mini');
});

it('returns a dashboard analytics summary with task statistics', async () => {
  const { ws, app } = fixture();
  ws.analytics.record({ kind: 'agent_run', dotId: ws.dots()[0].id, ok: true });
  const response = await app.request('/api/analytics');
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    usage: { agentRuns: number };
    taskStats: { total: number };
    daily: unknown[];
  };
  expect(body.usage.agentRuns).toBe(1);
  expect(body.taskStats.total).toBe(0);
  expect(body.daily.length).toBe(14);
});

it('stores and streams conversation attachments as base64 uploads', async () => {
  const { ws, app } = fixture();
  const dot = ws.dots()[0];
  ws.bindThread('thread-1', dot.id, 'Docs');
  const created = await app.request(
    '/api/conversations/thread-1/attachments',
    json({
      name: 'notes.txt',
      mimeType: 'text/plain',
      content: Buffer.from('Hello document').toString('base64'),
    }),
  );
  expect(created.status).toBe(201);
  const listed = await app.request('/api/conversations/thread-1/attachments');
  expect(((await listed.json()) as unknown[]).length).toBe(1);
  expect(ws.analytics.count('attachment_added')).toBe(1);
  expect(
    (await app.request('/api/conversations/other/attachments')).status,
  ).toBe(404);
});

it('creates a project and downloads it as a zip', async () => {
  const { ws, app } = fixture();
  const dot = ws.dots()[0];
  const created = await app.request(
    '/api/projects',
    json({
      dotId: dot.id,
      name: 'Portfolio',
      template: 'static',
      files: [{ path: 'index.html', content: '<h1>Portfolio</h1>' }],
    }),
  );
  expect(created.status).toBe(201);
  const project = (await created.json()) as { id: string };
  const download = await app.request(`/api/projects/${project.id}/download`);
  expect(download.status).toBe(200);
  expect(download.headers.get('content-type')).toBe('application/zip');
  expect((await download.arrayBuffer()).byteLength).toBeGreaterThan(0);
  expect(ws.analytics.count('project_created')).toBe(1);
});

it('rejects projects that try to escape the archive root', async () => {
  const { ws, app } = fixture();
  const response = await app.request(
    '/api/projects',
    json({
      dotId: ws.dots()[0].id,
      name: 'Bad',
      files: [{ path: '../escape.txt', content: 'x' }],
    }),
  );
  expect(response.status).toBe(400);
});
