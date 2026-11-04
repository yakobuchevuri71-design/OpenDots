import { useRef, useState } from 'react';
import { Download, Paperclip, Plus, X } from 'lucide-react';
import type { Attachment } from '../shared/types';
import { api, authHeaders } from './api';

const MAX_BYTES = 2_000_000;

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1_048_576) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1_048_576).toFixed(1)} MB`;
}

// Uses an authenticated request so stored files download even when the
// deployment sets OWNER_TOKEN and a plain link would be rejected.
async function downloadAttachment(threadId: string, item: Attachment) {
  const response = await fetch(
    `/api/conversations/${threadId}/attachments/${item.id}/raw`,
    { headers: authHeaders() },
  );
  if (!response.ok) throw new Error('The file could not be downloaded.');
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = item.name;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function toBase64(file: File): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < buffer.length; offset += chunk)
    binary += String.fromCharCode(...buffer.subarray(offset, offset + chunk));
  return btoa(binary);
}

// Documents for this conversation. The list loads when the panel opens, so
// plain chat never pays for an extra request. Text-like files are decoded on
// the server and shared with the Dot; binary files are stored and downloadable.
export function ChatAttachments({
  threadId,
  disabled,
  onError,
}: {
  threadId: string;
  disabled?: boolean;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Attachment[]>();
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const toggle = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (items) return;
    try {
      const value = await api<Attachment[]>(
        `/conversations/${threadId}/attachments`,
      );
      setItems(Array.isArray(value) ? value : []);
    } catch (e) {
      setItems([]);
      onError(e instanceof Error ? e.message : 'Could not load documents.');
    }
  };

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(files).slice(0, 5)) {
        if (file.size > MAX_BYTES) {
          onError(`${file.name} is larger than the 2 MB attachment limit.`);
          continue;
        }
        const created = await api<Attachment>(
          `/conversations/${threadId}/attachments`,
          'POST',
          {
            name: file.name,
            mimeType: file.type || 'application/octet-stream',
            content: await toBase64(file),
          },
        );
        setItems((list) => [...(list ?? []), created]);
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not attach the file.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const remove = async (id: string) => {
    try {
      await api(`/conversations/${threadId}/attachments/${id}`, 'DELETE', {});
      setItems((list) => list?.filter((item) => item.id !== id));
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not remove the file.');
    }
  };

  return (
    <div className="chat-attachments">
      <button
        type="button"
        className={`icon-button ${open ? 'active' : ''}`}
        aria-label="Documents for this conversation"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => void toggle()}
      >
        <Paperclip size={19} />
      </button>
      {open && (
        <div className="attachment-panel">
          <div className="attachment-panel-head">
            <strong>Documents</strong>
            <button
              type="button"
              className="icon-button"
              aria-label="Close documents"
              onClick={() => setOpen(false)}
            >
              <X size={14} />
            </button>
          </div>
          <p className="muted">
            Attached files are shared with this Dot as reference material. Text,
            Markdown, code, JSON and CSV are read in full; other files are
            stored and downloadable. Up to 2 MB each.
          </p>
          {items?.length ? (
            <ul className="attachment-chips">
              {items.map((item) => (
                <li key={item.id}>
                  <Paperclip size={12} />
                  <span>{item.name}</span>
                  <small>
                    {formatSize(item.size)} ·{' '}
                    {item.text ? 'readable' : 'stored only'}
                  </small>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Download ${item.name}`}
                    onClick={() =>
                      void downloadAttachment(threadId, item).catch((e) =>
                        onError(
                          e instanceof Error ? e.message : 'Download failed.',
                        ),
                      )
                    }
                  >
                    <Download size={12} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove ${item.name}`}
                    onClick={() => void remove(item.id)}
                  >
                    <X size={12} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No documents attached yet.</p>
          )}
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            <Plus size={14} />
            {busy ? 'Attaching…' : 'Attach files'}
          </button>
        </div>
      )}
      <input
        ref={input}
        type="file"
        multiple
        hidden
        aria-hidden="true"
        onChange={(e) => void upload(e.target.files)}
      />
    </div>
  );
}
