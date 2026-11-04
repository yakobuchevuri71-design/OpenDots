import { useEffect, useMemo, useRef, useState } from 'react';
import { Code2, Download, Eye, FileCode2, Plus, Trash2 } from 'lucide-react';
import type { Project, ProjectFile, ProjectSummary } from '../shared/types';
import { api, authHeaders } from './api';

// Downloads through an authenticated request so the ZIP still works when the
// deployment sets OWNER_TOKEN and a plain link would be rejected.
async function downloadProject(id: string, name: string) {
  const response = await fetch(`/api/projects/${id}/download`, {
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error('The download could not be prepared.');
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${name.replace(/[^\w.-]+/g, '-') || 'project'}.zip`;
  anchor.click();
  URL.revokeObjectURL(url);
}

// Renders one generated file as a sandboxed preview. Only HTML and SVG are
// rendered; other files are shown as source so the preview never runs app code.
function PreviewFrame({ files }: { files: ProjectFile[] }) {
  const [active, setActive] = useState<string>();
  const html = useMemo(() => {
    if (!files.length) return '';
    const index =
      files.find((file) => /(^|\/)index\.html?$/i.test(file.path)) ??
      files.find((file) => file.path.endsWith('.html'));
    if (!index) return '';
    const css = files
      .filter((file) => file.path.endsWith('.css'))
      .map((file) => `<style>\n${file.content}\n</style>`)
      .join('\n');
    const js = files
      .filter((file) => /\.(js|mjs)$/.test(file.path))
      .map((file) => `<script>\n${file.content}\n</script>`)
      .join('\n');
    const inlined = index.content
      .replace(/<link[^>]+href=["'][^"']+\.css["'][^>]*>/gi, '')
      .replace(/<script[^>]+src=["'][^"']+\.js["'][^>]*><\/script>/gi, '');
    return inlined.includes('</head>')
      ? inlined
          .replace('</head>', `${css}\n</head>`)
          .replace('</body>', `${js}\n</body>`)
      : `${inlined}\n${css}\n${js}`;
  }, [files]);

  const shown = active ? files.find((file) => file.path === active) : undefined;

  if (!files.length)
    return <p className="muted">This project has no files yet.</p>;

  return (
    <div className="project-preview">
      <div className="file-tabs" role="tablist" aria-label="Project files">
        {files.map((file) => (
          <button
            key={file.path}
            role="tab"
            aria-selected={active === file.path}
            className={active === file.path ? 'active' : ''}
            onClick={() =>
              setActive(active === file.path ? undefined : file.path)
            }
          >
            <FileCode2 size={13} />
            {file.path}
          </button>
        ))}
      </div>
      {shown ? (
        <pre className="project-source">{shown.content}</pre>
      ) : html ? (
        <iframe
          className="project-frame"
          title="Project preview"
          sandbox=""
          srcDoc={html}
        />
      ) : (
        <p className="muted">
          No HTML entry point. Select a file to read its source.
        </p>
      )}
    </div>
  );
}

export function Projects({
  dots,
  onError,
}: {
  dots: { id: string; name: string }[];
  onError: (message: string) => void;
}) {
  const [projects, setProjects] = useState<ProjectSummary[]>();
  const [selected, setSelected] = useState<Project>();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [template, setTemplate] = useState('static');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dotsRef = useRef(dots);
  dotsRef.current = dots;

  const load = async () => {
    try {
      setProjects(await api<ProjectSummary[]>('/projects'));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load projects.');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const open = async (id: string) => {
    try {
      setSelected(await api<Project>(`/projects/${id}`));
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not open the project.');
    }
  };

  const create = async () => {
    if (!name.trim() || !dots[0]) return;
    setBusy(true);
    setError('');
    try {
      const files: ProjectFile[] =
        template === 'node-api'
          ? [
              {
                path: 'server.mjs',
                content:
                  "import { createServer } from 'node:http';\n\nconst port = process.env.PORT ?? 3000;\ncreateServer((request, response) => {\n  response.writeHead(200, { 'Content-Type': 'text/plain' });\n  response.end('Hello from OpenDots');\n}).listen(port, () => console.log(`Listening on ${port}`));\n",
              },
              {
                path: 'README.md',
                content: `# ${name}\n\nRun with:\n\n\`\`\`sh\nnode server.mjs\n\`\`\`\n`,
              },
            ]
          : template === 'react-vite'
            ? [
                {
                  path: 'index.html',
                  content: `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>${name}</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.jsx"></script>\n  </body>\n</html>\n`,
                },
                {
                  path: 'src/main.jsx',
                  content:
                    "import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport { App } from './App.jsx';\n\ncreateRoot(document.getElementById('root')).render(<App />);\n",
                },
                {
                  path: 'src/App.jsx',
                  content: `import React from 'react';\n\nexport function App() {\n  return <main><h1>${name}</h1><p>Edit src/App.jsx to begin.</p></main>;\n}\n`,
                },
                {
                  path: 'README.md',
                  content: `# ${name}\n\n\`\`\`sh\nnpm create vite@latest . -- --template react\nnpm install\nnpm run dev\n\`\`\`\n`,
                },
              ]
            : [
                {
                  path: 'index.html',
                  content: `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>${name}</title>\n    <link rel="stylesheet" href="style.css" />\n  </head>\n  <body>\n    <main>\n      <h1>${name}</h1>\n      <p>Edit index.html to begin.</p>\n    </main>\n  </body>\n</html>\n`,
                },
                {
                  path: 'style.css',
                  content:
                    'body { font-family: system-ui, sans-serif; margin: 0; display: grid; place-items: center; min-height: 100vh; }\n',
                },
              ];
      const project = await api<Project>('/projects', 'POST', {
        dotId: dots[0].id,
        name: name.trim(),
        template,
        files,
      });
      setName('');
      setCreating(false);
      await load();
      setSelected(project);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not create the project.',
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this project and its files?')) return;
    try {
      await api(`/projects/${id}`, 'DELETE', {});
      if (selected?.id === id) setSelected(undefined);
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not delete the project.');
    }
  };

  return (
    <div className="projects-view">
      <div className="dashboard-toolbar">
        <span className="muted">
          Websites and apps your Dots generate. Preview in a sandbox, then
          download the source.
        </span>
        <button className="primary" onClick={() => setCreating(!creating)}>
          <Plus size={15} />
          New project
        </button>
      </div>

      {error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}

      {creating && (
        <div className="project-create">
          <label>
            <span className="field-label">Project name</span>
            <input
              value={name}
              maxLength={120}
              placeholder="Marketing site"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            <span className="field-label">Starting point</span>
            <select
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
            >
              <option value="static">Static website (HTML/CSS)</option>
              <option value="react-vite">React + Vite app</option>
              <option value="node-api">Node API service</option>
            </select>
          </label>
          <button
            className="primary"
            disabled={busy || !name.trim()}
            onClick={() => void create()}
          >
            Create
          </button>
        </div>
      )}

      <div className="projects-layout">
        <div className="project-list">
          {projects?.map((project) => (
            <article
              key={project.id}
              className={`project-row ${selected?.id === project.id ? 'active' : ''}`}
            >
              <button
                aria-label={`Open ${project.name}`}
                onClick={() => void open(project.id)}
              >
                <Code2 size={16} />
                <div>
                  <strong>{project.name}</strong>
                  <small>
                    {project.template} · {project.fileCount} files ·{' '}
                    {dots.find((dot) => dot.id === project.dotId)?.name ??
                      'Dot'}
                  </small>
                </div>
              </button>
              <button
                className="icon-button"
                aria-label={`Download ${project.name}`}
                onClick={() =>
                  void downloadProject(project.id, project.name).catch((e) =>
                    onError(
                      e instanceof Error ? e.message : 'Download failed.',
                    ),
                  )
                }
              >
                <Download size={15} />
              </button>
              <button
                className="icon-button"
                aria-label={`Delete ${project.name}`}
                onClick={() => void remove(project.id)}
              >
                <Trash2 size={15} />
              </button>
            </article>
          ))}
          {projects && !projects.length && (
            <div className="large-empty">
              <Code2 size={28} />
              <h2>No projects yet.</h2>
              <p>
                Ask a Dot to build a website or app, or create a starting point
                above.
              </p>
            </div>
          )}
        </div>

        {selected && (
          <section className="project-detail">
            <header>
              <div>
                <h2>{selected.name}</h2>
                {selected.description && <p>{selected.description}</p>}
              </div>
              <div className="project-actions">
                <span className="muted">
                  <Eye size={13} /> sandboxed preview
                </span>
                <button
                  className="primary"
                  onClick={() =>
                    void downloadProject(selected.id, selected.name).catch(
                      (e) =>
                        onError(
                          e instanceof Error ? e.message : 'Download failed.',
                        ),
                    )
                  }
                >
                  <Download size={15} />
                  Download ZIP
                </button>
              </div>
            </header>
            <PreviewFrame files={selected.files} />
          </section>
        )}
      </div>
    </div>
  );
}
