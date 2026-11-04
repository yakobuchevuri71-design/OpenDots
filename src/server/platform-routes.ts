import { Hono } from 'hono';
import { z } from 'zod';
import { AttachmentError, MAX_ATTACHMENT_BYTES } from './attachments.js';
import { MODEL_CATALOG } from './models.js';
import { ProjectError, validateFiles } from './projects.js';
import type { Platform } from './platform.js';
import type { Status } from '../shared/types.js';

const statuses: Status[] = [
  'queued',
  'running',
  'paused',
  'completed',
  'failed',
  'interrupted',
  'cancelled',
];

const projectInput = z
  .object({
    dotId: z.string().min(1),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).default(''),
    template: z.enum(['static', 'react-vite', 'node-api']).default('static'),
    files: z.array(z.unknown()).min(1).max(200),
  })
  .strict();

// Dashboard, model catalogue, document attachments and generated projects.
export function platformRoutes(platform: Platform) {
  const app = new Hono();

  app.get('/analytics', (c) => {
    const names = new Map(
      platform.workspace.dots().map((dot) => [dot.id, dot.name]),
    );
    const summary = platform.workspace.analytics.summary(names);
    const tasks = platform.store.tasks();
    const taskStats = Object.fromEntries(
      statuses.map((status) => [
        status,
        tasks.filter((task) => task.status === status).length,
      ]),
    ) as Record<Status, number>;
    return c.json({
      ...summary,
      taskStats: { ...taskStats, total: tasks.length },
    });
  });

  app.get('/models', (c) =>
    c.json({
      catalog: MODEL_CATALOG,
      default: platform.config.model ?? null,
      baseUrl: platform.config.baseUrl,
    }),
  );

  app.get('/conversations/:id/attachments', (c) => {
    const thread = platform.workspace.requireThread(c.req.param('id'));
    return c.json(platform.workspace.attachments.list(thread.id));
  });

  app.post('/conversations/:id/attachments', async (c) => {
    const thread = platform.workspace.requireThread(c.req.param('id'));
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(200),
        mimeType: z.string().trim().max(200).default('text/plain'),
        content: z.string().min(1).max(3_000_000),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: 'Provide a file name and base64 content.' }, 400);
    let bytes: Buffer;
    try {
      bytes = Buffer.from(parsed.data.content, 'base64');
    } catch {
      return c.json({ error: 'Attachment content was not valid base64.' }, 400);
    }
    if (!bytes.length)
      return c.json({ error: 'The uploaded file is empty.' }, 400);
    if (bytes.length > MAX_ATTACHMENT_BYTES)
      return c.json(
        {
          error: `Attachments are limited to ${Math.round(MAX_ATTACHMENT_BYTES / 1000)} KB.`,
        },
        413,
      );
    try {
      const attachment = platform.workspace.attachments.add(
        thread.id,
        parsed.data.name,
        parsed.data.mimeType,
        bytes,
      );
      platform.workspace.analytics.record({
        kind: 'attachment_added',
        dotId: thread.dotId,
        threadId: thread.id,
        refId: attachment.id,
        meta: { kind: attachment.kind, size: attachment.size },
      });
      return c.json(attachment, 201);
    } catch (error) {
      if (error instanceof AttachmentError)
        return c.json({ error: error.message }, error.status);
      throw error;
    }
  });

  app.get('/conversations/:id/attachments/:attachmentId/raw', (c) => {
    const thread = platform.workspace.requireThread(c.req.param('id'));
    const attachment = platform.workspace.attachments
      .list(thread.id)
      .find((item) => item.id === c.req.param('attachmentId'));
    if (!attachment) return c.json({ error: 'Attachment not found.' }, 404);
    const data = platform.workspace.attachments.data(thread.id, attachment.id);
    if (!data) return c.json({ error: 'Attachment data is unavailable.' }, 404);
    return c.body(new Uint8Array(data), 200, {
      'Content-Type': attachment.mimeType,
      'Content-Disposition': `attachment; filename="${attachment.name.replace(/"/g, '')}"`,
      'Cache-Control': 'no-store',
    });
  });

  app.delete('/conversations/:id/attachments/:attachmentId', (c) => {
    const thread = platform.workspace.requireThread(c.req.param('id'));
    return platform.workspace.attachments.remove(
      thread.id,
      c.req.param('attachmentId'),
    )
      ? c.json({ ok: true })
      : c.json({ error: 'Attachment not found.' }, 404);
  });

  app.get('/projects', (c) => c.json(platform.workspace.projects.list()));

  app.post('/projects', async (c) => {
    const parsed = projectInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json(
        { error: 'Provide a project name and at least one file.' },
        400,
      );
    if (!platform.workspace.dot(parsed.data.dotId))
      return c.json({ error: 'Dot not found.' }, 404);
    try {
      const project = platform.workspace.projects.create({
        dotId: parsed.data.dotId,
        name: parsed.data.name,
        description: parsed.data.description,
        template: parsed.data.template,
        files: validateFiles(parsed.data.files),
      });
      platform.workspace.analytics.record({
        kind: 'project_created',
        dotId: project.dotId,
        refId: project.id,
        meta: { template: project.template, files: project.files.length },
      });
      return c.json(project, 201);
    } catch (error) {
      if (error instanceof ProjectError)
        return c.json({ error: error.message }, error.status);
      throw error;
    }
  });

  app.get('/projects/:id', (c) => {
    try {
      return c.json(platform.workspace.projects.require(c.req.param('id')));
    } catch (error) {
      if (error instanceof ProjectError)
        return c.json({ error: error.message }, error.status);
      throw error;
    }
  });

  app.put('/projects/:id', async (c) => {
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(120).optional(),
        description: z.string().trim().max(500).optional(),
        files: z.array(z.unknown()).min(1).max(200).optional(),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: 'Provide a valid project patch.' }, 400);
    try {
      return c.json(
        platform.workspace.projects.update(c.req.param('id'), {
          name: parsed.data.name,
          description: parsed.data.description,
          files: parsed.data.files
            ? validateFiles(parsed.data.files)
            : undefined,
        }),
      );
    } catch (error) {
      if (error instanceof ProjectError)
        return c.json({ error: error.message }, error.status);
      throw error;
    }
  });

  app.delete('/projects/:id', (c) =>
    platform.workspace.projects.remove(c.req.param('id'))
      ? c.json({ ok: true })
      : c.json({ error: 'Project not found.' }, 404),
  );

  app.get('/projects/:id/download', (c) => {
    let archive: Buffer;
    let name: string;
    try {
      const project = platform.workspace.projects.require(c.req.param('id'));
      archive = platform.workspace.projects.archive(project.id);
      name = project.name;
    } catch (error) {
      if (error instanceof ProjectError)
        return c.json({ error: error.message }, error.status);
      throw error;
    }
    const safe = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    return c.body(new Uint8Array(archive), 200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${safe || 'project'}.zip"`,
      'Cache-Control': 'no-store',
    });
  });

  return app;
}
