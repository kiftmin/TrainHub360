# TrainHub360

TrainHub360 helps corporate L&D teams manage programmes, prove competence, and keep workforce readiness visible.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm --filter @workspace/trainhub360 run dev` — run the web app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- Required secret: `DB_CONNECTION_STRING` — external Microsoft SQL Server connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 + `mssql`
- DB: external Microsoft SQL Server via `process.env.DB_CONNECTION_STRING`
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/trainhub360/src/App.tsx` — responsive web shell and product routes
- `artifacts/trainhub360/src/index.css` — TrainHub360 visual tokens and motion
- `artifacts/api-server/src/routes/trainhub.ts` — tenant-scoped training API routes
- `artifacts/api-server/src/lib/mssql.ts` — SQL Server pool, schema bootstrap, seed data, and explicit demo fallback
- `lib/api-spec/openapi.yaml` — API contract source of truth

## Architecture decisions

- The API is contract-first: change `lib/api-spec/openapi.yaml`, then run codegen before using new client hooks.
- Every SQL query takes an organization scope from the request context and every tenant table stores `organization_id`.
- Course competence is gated by applied/scenario score; recall score alone cannot mark a course competent.
- Review credit keeps manager sign-off enabled and server-enforced; assessment, timeliness, and application weights must sum to 100%.
- If the configured SQL Server cannot be reached, the API labels responses as `demo-workspace` so the UI stays usable without disguising the connection state.

## Product

- Manager overview with compliance health, competence rate, expiring credentials, drop-off, time-to-competency, trainer utilization, activity, and programme pulse.
- Learning catalogue with course creation and applied-threshold tracking.
- Assessment submission that distinguishes applied and recall evidence.
- Unified calendar for online/offline sessions plus 1:1 booking.
- Threaded programme messaging with urgent flags.
- Optional performance review credit settings and CSV export.

## User preferences

- Use `DB_CONNECTION_STRING` from Replit Secrets; never place the connection string in source or logs.

## Gotchas

- The SQL Server endpoint must be reachable from the running workflow for persistent data. When it is unavailable, demo data is in-memory and is not durable.
- Use the shared proxy paths (`/api/...`) from the browser; do not hardcode localhost in app code.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
