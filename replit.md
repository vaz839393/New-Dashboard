# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Discord**: discord.js-selfbot-v13 (selfbot)

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   └── api-server/         # Express API server + Discord Selfbot Dashboard
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts (single workspace package)
│   └── src/                # Individual .ts scripts, run via `pnpm --filter @workspace/scripts run <script>`
├── pnpm-workspace.yaml     # pnpm workspace (artifacts/*, lib/*, lib/integrations/*, scripts)
├── tsconfig.base.json      # Shared TS options (composite, bundler resolution, es2022)
├── tsconfig.json           # Root TS project references
└── package.json            # Root package with hoisted devDeps
```

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `pnpm run typecheck` (which runs `tsc --build --emitDeclarationOnly`). This builds the full dependency graph so that cross-package imports resolve correctly. Running `tsc` inside a single package will fail if its dependencies haven't been built yet.
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck; actual JS bundling is handled by esbuild/tsx/vite...etc, not `tsc`.
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array. `tsc --build` uses this to determine build order and skip up-to-date packages.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages that define it
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server + Discord Selfbot Dashboard. Serves both the REST API at `/api` and the dashboard UI at `/`.

- Entry: `src/index.ts` — reads `PORT`, starts Express, auto-starts bot
- App setup: `src/app.ts` — mounts CORS, JSON/urlencoded parsing, routes at `/api`, static files at `/`
- Bot: `src/lib/bot.ts` — discord.js-selfbot-v13 client (auto-react, message sending, token switching)
- Config: `src/lib/config.ts` — JSON file persistence (`data/config.json`) for toggles, emoji, channelId, token
- Routes: `src/routes/index.ts` mounts sub-routers
  - `src/routes/health.ts` — `GET /api/healthz`
  - `src/routes/dashboard.ts` — dashboard REST API (`/api/dashboard/*`)
- Dashboard UI: `public/index.html` — Discord-themed web dashboard (vanilla HTML/JS)
- Depends on: `@workspace/db`, `@workspace/api-zod`, `discord.js-selfbot-v13`
- `pnpm --filter @workspace/api-server run dev` — run the dev server
- `pnpm --filter @workspace/api-server run build` — production esbuild bundle (`dist/index.mjs`)
- `discord.js-selfbot-v13` is externalized in esbuild (not bundled) due to complex native deps

### Dashboard API Endpoints

- `GET /api/dashboard/status` — returns bot status + config
- `POST /api/dashboard/auto-react` — `{ enabled, emoji }` — toggle auto-react
- `POST /api/dashboard/clipboard-messenger` — `{ enabled, channelId }` — toggle clipboard messenger
- `POST /api/dashboard/send-message` — `{ message, channelId? }` — send a message
- `POST /api/dashboard/change-token` — `{ token }` — update token and reconnect bot
- `POST /api/dashboard/restart-bot` — restart bot with current token

### Config Persistence

Config is stored at `artifacts/api-server/data/config.json`:
```json
{
  "autoReact": { "enabled": false, "emoji": "👍" },
  "clipboardMessenger": { "enabled": false, "channelId": "" },
  "discordToken": "..."
}
```

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL.

### `lib/api-spec` (`@workspace/api-spec`)

OpenAPI 3.1 spec + Orval codegen config. Run: `pnpm --filter @workspace/api-spec run codegen`

### `lib/api-zod` (`@workspace/api-zod`)

Generated Zod schemas from the OpenAPI spec.

### `lib/api-client-react` (`@workspace/api-client-react`)

Generated React Query hooks from the OpenAPI spec.

### `scripts` (`@workspace/scripts`)

Utility scripts package.
