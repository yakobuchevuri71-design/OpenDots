# OpenDots — agent notes

## What this is

OpenDots is a CopilotKit/AG-UI template: persistent AI agents ("Dots"), each with
its own computer, Web + Mobile. Conversations require CopilotKit Intelligence or
an OpenAI-compatible model endpoint.

## Layout

- `src/client/` — React UI. `App.tsx` owns the view union
  (`chat | tasks | memories | space | dashboard | projects`) plus sidebar/topbar
  navigation. Views: `Dashboard.tsx`, `Projects.tsx`, `ChatAttachments.tsx`.
- `src/server/` — Hono server. `app.ts` mounts routes under `/api`; `index.ts`
  boots. Feature stores: `analytics.ts`, `attachments.ts`, `projects.ts`,
  `models.ts`; routes in `platform-routes.ts`, `workspace-routes.ts`.
- `src/shared/types.ts` — types shared by client and server.
- `tests/` — vitest (node + jsdom via react-test-renderer).

## Commands

```
npm run dev        # vite + tsx watch server
npm run typecheck  # tsc --noEmit
npm run lint       # eslint src tests vite.config.ts
npm test           # vitest run
npm run build      # vite build && tsc -p tsconfig.server.json
npm run start      # serve dist (needs a prior build)
```

## Conventions that matter

- **CSS**: add styles to `src/client/style.css` using existing tokens
  (`--line`, `--muted`, `--blue`, `--lavender`). Dark mode is derived at build
  time by the PostCSS plugin in `src/build/dark-theme.ts`; do not hand-write
  `:root[data-theme=dark]` rules for new components.
- **Auth**: the client sends the owner token via `authHeaders()` from
  `src/client/api.ts`. Plain `<a href="/api/...">` links cannot carry the token,
  so file/ZIP downloads must fetch with `authHeaders()` and use a blob URL.
- **Agent tools**: add a tool in `src/server/*-tools.ts`, then include it in the
  tool list inside `src/server/dot-agent.ts`.
- **Analytics**: record via `workspace.analytics.record({ kind, ... })`. Keep
  metadata coarse — no prompts, tool arguments, or results.
- **Migrations**: add columns by extending the `ALTER TABLE` list in
  `src/server/workspace.ts`.
- `knip` reports some pre-existing unused exports; that is not new breakage.

## Verification limits

No model/Intelligence credentials exist in the default environment, so live AI
turns, streaming, voice/calls, and Slack cannot be verified here. Conversation
creation returns `Setup required: INTELLIGENCE_API_KEY ...`. Verify with
typecheck, lint, format, tests, build, non-LLM endpoints, and browser rendering.

GitHub Actions is disabled on this fork (`actions/workflows` is empty), so CI
checks will not appear on pull requests.
