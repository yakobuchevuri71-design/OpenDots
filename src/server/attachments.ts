import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { Attachment } from '../shared/types.js';

export const MAX_ATTACHMENT_BYTES = 2_000_000;
const MAX_TEXT_CHARS = 20_000;
const MAX_ATTACHMENTS_PER_THREAD = 20;

const TEXT_EXTENSIONS: Record<string, Attachment['kind']> = {
  txt: 'text',
  md: 'markdown',
  markdown: 'markdown',
  json: 'json',
  csv: 'csv',
  tsv: 'csv',
  log: 'text',
  yml: 'code',
  yaml: 'code',
  toml: 'code',
  ini: 'code',
  xml: 'code',
  html: 'code',
  css: 'code',
  js: 'code',
  mjs: 'code',
  cjs: 'code',
  ts: 'code',
  tsx: 'code',
  jsx: 'code',
  py: 'code',
  rb: 'code',
  go: 'code',
  rs: 'code',
  java: 'code',
  kt: 'code',
  swift: 'code',
  c: 'code',
  h: 'code',
  cpp: 'code',
  sh: 'code',
  sql: 'code',
};

export class AttachmentError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 413 = 400,
  ) {
    super(message);
  }
}

function classify(name: string, mimeType: string): Attachment['kind'] {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  if (TEXT_EXTENSIONS[extension]) return TEXT_EXTENSIONS[extension];
  if (mimeType.includes('json')) return 'json';
  if (mimeType.includes('csv')) return 'csv';
  if (mimeType.includes('markdown')) return 'markdown';
  if (mimeType.startsWith('text/')) return 'text';
  return 'binary';
}

function extractText(kind: Attachment['kind'], bytes: Buffer): string | null {
  if (kind === 'binary') return null;
  const text = bytes.toString('utf8');
  return text.length > MAX_TEXT_CHARS
    ? `${text.slice(0, MAX_TEXT_CHARS)}\n\n[truncated at ${MAX_TEXT_CHARS} characters]`
    : text;
}

// Document understanding for conversations. Text-like files are decoded and
// bounded so a Dot can reason about them without leaving the machine.
export class Attachments {
  constructor(private db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS attachments(
      id TEXT PRIMARY KEY,
      threadId TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      mimeType TEXT NOT NULL,
      size INTEGER NOT NULL,
      text TEXT,
      data BLOB,
      createdAt INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS attachments_thread ON attachments(threadId, createdAt);`);
  }

  list(threadId: string): Attachment[] {
    return this.db
      .prepare(
        'SELECT id, threadId, name, kind, mimeType, size, text, createdAt FROM attachments WHERE threadId=? ORDER BY createdAt',
      )
      .all(threadId) as unknown as Attachment[];
  }

  count(threadId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM attachments WHERE threadId=?')
      .get(threadId) as { n: number } | undefined;
    return row?.n ?? 0;
  }

  add(
    threadId: string,
    name: string,
    mimeType: string,
    bytes: Buffer,
  ): Attachment {
    if (bytes.length === 0)
      throw new AttachmentError('The uploaded file is empty.');
    if (bytes.length > MAX_ATTACHMENT_BYTES)
      throw new AttachmentError(
        `Attachments are limited to ${Math.round(MAX_ATTACHMENT_BYTES / 1000)} KB.`,
        413,
      );
    if (this.count(threadId) >= MAX_ATTACHMENTS_PER_THREAD)
      throw new AttachmentError(
        `A conversation can hold at most ${MAX_ATTACHMENTS_PER_THREAD} attachments.`,
      );
    const kind = classify(name, mimeType);
    const attachment: Attachment = {
      id: randomUUID(),
      threadId,
      name: name.slice(0, 200) || 'attachment',
      kind,
      mimeType: mimeType.slice(0, 200) || 'application/octet-stream',
      size: bytes.length,
      createdAt: Date.now(),
      text: extractText(kind, bytes),
    };
    this.db
      .prepare(
        'INSERT INTO attachments(id, threadId, name, kind, mimeType, size, text, data, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        attachment.id,
        threadId,
        attachment.name,
        attachment.kind,
        attachment.mimeType,
        attachment.size,
        attachment.text,
        bytes,
        attachment.createdAt,
      );
    return attachment;
  }

  data(threadId: string, id: string): Buffer | null {
    const row = this.db
      .prepare('SELECT data FROM attachments WHERE id=? AND threadId=?')
      .get(id, threadId) as { data: Uint8Array | null } | undefined;
    return row?.data ? Buffer.from(row.data) : null;
  }

  remove(threadId: string, id: string): boolean {
    return (
      this.db
        .prepare('DELETE FROM attachments WHERE id=? AND threadId=?')
        .run(id, threadId).changes > 0
    );
  }

  removeForThread(threadId: string) {
    this.db.prepare('DELETE FROM attachments WHERE threadId=?').run(threadId);
  }

  // Bounded document context injected ahead of a user turn.
  context(threadId: string): string | null {
    const readable = this.list(threadId).filter(
      (item) => typeof item.text === 'string' && item.text.trim(),
    );
    if (!readable.length) return null;
    const budget = 40_000;
    let used = 0;
    const parts: string[] = [];
    for (const item of readable) {
      const body = item.text!.trim();
      const remaining = budget - used;
      if (remaining <= 0) break;
      const chunk = body.slice(0, Math.min(remaining, 12_000));
      used += chunk.length;
      parts.push(
        `<document name="${item.name}" type="${item.kind}">\n${chunk}\n</document>`,
      );
    }
    return parts.join('\n\n');
  }
}
