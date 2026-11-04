import { DatabaseSync } from 'node:sqlite';
import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  ProjectError,
  Projects,
  validateFiles,
  zipArchive,
} from '../src/server/projects.js';

function fixture() {
  return new Projects(new DatabaseSync(':memory:'));
}

// Minimal reader for the store-only archives we emit. It walks the central
// directory, then reads each local header to recover the original bytes, so a
// broken offset or CRC would fail the test rather than silently pass.
function readZip(buffer: Buffer): Map<string, Buffer> {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error('No end-of-central-directory record.');
  const count = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50)
      throw new Error('Bad central directory signature.');
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer
      .subarray(cursor + 46, cursor + 46 + nameLength)
      .toString('utf8');
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50)
      throw new Error('Bad local header signature.');
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const size = buffer.readUInt32LE(localOffset + 22);
    const expectedCrc = buffer.readUInt32LE(localOffset + 14);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const body = buffer.subarray(start, start + size);
    if (crc32(body) >>> 0 !== expectedCrc)
      throw new Error(`CRC mismatch for ${name}`);
    files.set(name, Buffer.from(body));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

describe('generated web and app projects', () => {
  it('creates, lists, updates and deletes projects', () => {
    const projects = fixture();
    const project = projects.create({
      dotId: 'dot-1',
      name: 'Landing page',
      template: 'static',
      files: [{ path: 'index.html', content: '<h1>Hi</h1>' }],
    });
    expect(projects.list()[0]).toMatchObject({
      id: project.id,
      fileCount: 1,
      template: 'static',
    });
    const updated = projects.update(project.id, {
      files: [
        { path: 'index.html', content: '<h1>Hello</h1>' },
        { path: 'style.css', content: 'body{}' },
      ],
    });
    expect(updated.files).toHaveLength(2);
    expect(projects.remove(project.id)).toBe(true);
    expect(projects.get(project.id)).toBeUndefined();
  });

  it('rejects traversal, duplicates and missing files', () => {
    expect(() => validateFiles([{ path: '../secret', content: 'x' }])).toThrow(
      ProjectError,
    );
    expect(() =>
      validateFiles([
        { path: 'a.txt', content: 'x' },
        { path: 'a.txt', content: 'y' },
      ]),
    ).toThrow(ProjectError);
    expect(() => validateFiles([{ path: '', content: 'x' }])).toThrow(
      ProjectError,
    );
  });

  it('produces a valid, self-consistent zip archive', () => {
    const archive = zipArchive([
      { path: 'index.html', content: '<!doctype html><title>Hi</title>' },
      { path: 'src/app.js', content: 'console.log("hi");' },
    ]);
    const files = readZip(archive);
    expect([...files.keys()]).toEqual(['index.html', 'src/app.js']);
    expect(files.get('src/app.js')?.toString('utf8')).toBe(
      'console.log("hi");',
    );
  });

  it('archives a stored project and requires known ids', () => {
    const projects = fixture();
    const project = projects.create({
      dotId: 'dot-1',
      name: 'App',
      files: [{ path: 'README.md', content: '# App' }],
    });
    expect(projects.archive(project.id).length).toBeGreaterThan(0);
    expect(() => projects.require('missing')).toThrow(ProjectError);
  });
});
