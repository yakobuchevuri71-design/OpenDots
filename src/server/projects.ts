import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { crc32 } from 'node:zlib';
import type { Project, ProjectFile, ProjectSummary } from '../shared/types.js';

const MAX_PROJECTS = 100;
const MAX_FILES = 200;
const MAX_FILE_CHARS = 100_000;
const MAX_TOTAL_CHARS = 1_000_000;

export class ProjectError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

function dosDateTime(at: number) {
  const date = new Date(at);
  const time =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const day =
    ((date.getFullYear() - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();
  return { time, day };
}

// Store-only ZIP writer (method 0). No third-party archive dependency, and the
// archive is assembled in memory so no code is ever executed on the server.
export function zipArchive(files: ProjectFile[], at = Date.now()): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  const { time, day } = dosDateTime(at);
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.path.replace(/^\/+/, ''), 'utf8');
    const body = Buffer.from(file.content, 'utf8');
    const crc = crc32(body) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, body);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(0, 10);
    entry.writeUInt16LE(time, 12);
    entry.writeUInt16LE(day, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(body.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt16LE(0, 30);
    entry.writeUInt16LE(0, 32);
    entry.writeUInt16LE(0, 34);
    entry.writeUInt16LE(0, 36);
    entry.writeUInt32LE(0, 38);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += local.length + name.length + body.length;
  }
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, centralBuffer, end]);
}

function safePath(path: string): string | null {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!normalized || normalized.length > 300) return null;
  if (normalized.split('/').some((part) => part === '..' || part === ''))
    return null;
  return normalized;
}

export function validateFiles(input: unknown): ProjectFile[] {
  if (!Array.isArray(input))
    throw new ProjectError('Project files are required.');
  if (input.length > MAX_FILES)
    throw new ProjectError(`A project can hold at most ${MAX_FILES} files.`);
  let total = 0;
  const seen = new Set<string>();
  const files: ProjectFile[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object')
      throw new ProjectError('Each project file needs a path and content.');
    const { path, content } = raw as { path?: unknown; content?: unknown };
    if (typeof path !== 'string' || typeof content !== 'string')
      throw new ProjectError('Each project file needs a path and content.');
    const normalized = safePath(path);
    if (!normalized)
      throw new ProjectError(
        'File paths must be relative and must not contain ".." segments.',
      );
    if (seen.has(normalized))
      throw new ProjectError(`Duplicate file path: ${normalized}`);
    if (content.length > MAX_FILE_CHARS)
      throw new ProjectError(`File ${normalized} exceeds the size limit.`);
    seen.add(normalized);
    total += content.length;
    if (total > MAX_TOTAL_CHARS)
      throw new ProjectError('The project exceeds the total size limit.');
    files.push({ path: normalized, content });
  }
  return files;
}

export class Projects {
  constructor(private db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS projects(
      id TEXT PRIMARY KEY,
      dotId TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      template TEXT NOT NULL DEFAULT 'static',
      status TEXT NOT NULL DEFAULT 'draft',
      files TEXT NOT NULL DEFAULT '[]',
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS projects_created ON projects(createdAt DESC);`);
  }

  list(): ProjectSummary[] {
    const rows = this.db
      .prepare(
        'SELECT id, dotId, name, description, template, status, files, createdAt, updatedAt FROM projects ORDER BY updatedAt DESC',
      )
      .all() as unknown as (Omit<Project, 'files'> & { files: string })[];
    return rows.map((row) => ({
      id: row.id,
      dotId: row.dotId,
      name: row.name,
      description: row.description,
      template: row.template,
      status: row.status,
      fileCount: (JSON.parse(row.files) as ProjectFile[]).length,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  get(id: string): Project | undefined {
    const row = this.db
      .prepare('SELECT * FROM projects WHERE id=?')
      .get(id) as unknown as
      (Omit<Project, 'files'> & { files: string }) | undefined;
    return row
      ? { ...row, files: JSON.parse(row.files) as ProjectFile[] }
      : undefined;
  }

  require(id: string): Project {
    const project = this.get(id);
    if (!project) throw new ProjectError('Project not found.', 404);
    return project;
  }

  create(input: {
    dotId: string;
    name: string;
    description?: string;
    template?: string;
    files: ProjectFile[];
    status?: Project['status'];
  }): Project {
    if (this.list().length >= MAX_PROJECTS)
      throw new ProjectError(
        `This workspace already holds the maximum of ${MAX_PROJECTS} projects.`,
      );
    const now = Date.now();
    const project: Project = {
      id: randomUUID(),
      dotId: input.dotId,
      name: input.name.slice(0, 120),
      description: (input.description ?? '').slice(0, 500),
      template: (input.template ?? 'static').slice(0, 60),
      status: input.status ?? 'ready',
      files: input.files,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare('INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        project.id,
        project.dotId,
        project.name,
        project.description,
        project.template,
        project.status,
        JSON.stringify(project.files),
        project.createdAt,
        project.updatedAt,
      );
    return project;
  }

  update(
    id: string,
    patch: {
      name?: string;
      description?: string;
      files?: ProjectFile[];
      status?: Project['status'];
    },
  ): Project {
    const current = this.require(id);
    const next: Project = {
      ...current,
      name: patch.name?.slice(0, 120) ?? current.name,
      description: patch.description?.slice(0, 500) ?? current.description,
      files: patch.files ?? current.files,
      status: patch.status ?? current.status,
      updatedAt: Date.now(),
    };
    this.db
      .prepare(
        'UPDATE projects SET name=?, description=?, files=?, status=?, updatedAt=? WHERE id=?',
      )
      .run(
        next.name,
        next.description,
        JSON.stringify(next.files),
        next.status,
        next.updatedAt,
        id,
      );
    return next;
  }

  remove(id: string): boolean {
    return (
      this.db.prepare('DELETE FROM projects WHERE id=?').run(id).changes > 0
    );
  }

  archive(id: string): Buffer {
    return zipArchive(this.require(id).files);
  }
}
