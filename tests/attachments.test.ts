import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  AttachmentError,
  Attachments,
  MAX_ATTACHMENT_BYTES,
} from '../src/server/attachments.js';

function fixture() {
  return new Attachments(new DatabaseSync(':memory:'));
}

describe('conversation document understanding', () => {
  it('decodes text-like files and classifies them by extension', () => {
    const attachments = fixture();
    const markdown = attachments.add(
      'thread-1',
      'brief.md',
      'text/markdown',
      Buffer.from('# Title\nBody'),
    );
    expect(markdown.kind).toBe('markdown');
    expect(markdown.text).toContain('Body');
    const code = attachments.add(
      'thread-1',
      'app.ts',
      'text/plain',
      Buffer.from('export const x = 1;'),
    );
    expect(code.kind).toBe('code');
  });

  it('keeps binary files without decoding them', () => {
    const attachments = fixture();
    const binary = attachments.add(
      'thread-1',
      'photo.png',
      'image/png',
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );
    expect(binary.kind).toBe('binary');
    expect(binary.text).toBeNull();
    expect(attachments.data('thread-1', binary.id)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );
  });

  it('rejects empty and oversized uploads', () => {
    const attachments = fixture();
    expect(() =>
      attachments.add('thread-1', 'empty.txt', 'text/plain', Buffer.alloc(0)),
    ).toThrow(AttachmentError);
    expect(() =>
      attachments.add(
        'thread-1',
        'big.txt',
        'text/plain',
        Buffer.alloc(MAX_ATTACHMENT_BYTES + 1),
      ),
    ).toThrow(AttachmentError);
  });

  it('builds bounded document context and scopes it to its thread', () => {
    const attachments = fixture();
    attachments.add(
      'thread-1',
      'notes.txt',
      'text/plain',
      Buffer.from('Remember the launch date.'),
    );
    const context = attachments.context('thread-1');
    expect(context).toContain('notes.txt');
    expect(context).toContain('launch date');
    expect(attachments.context('thread-2')).toBeNull();
  });

  it('removes attachments individually and by thread', () => {
    const attachments = fixture();
    const one = attachments.add(
      'thread-1',
      'a.txt',
      'text/plain',
      Buffer.from('a'),
    );
    attachments.add('thread-1', 'b.txt', 'text/plain', Buffer.from('b'));
    expect(attachments.remove('thread-1', one.id)).toBe(true);
    expect(attachments.list('thread-1')).toHaveLength(1);
    attachments.removeForThread('thread-1');
    expect(attachments.list('thread-1')).toHaveLength(0);
  });
});
