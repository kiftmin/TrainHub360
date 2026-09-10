# TrainHub360

Corporate training platform proving training worked, not just that it happened.

## Quick start (Postgres via Docker)
```
docker compose up --build
```
Backend: http://localhost:4000/api/healthz · Frontend: http://localhost:5173

## SQL Server note
The provided connection string `Server=69.30.247.60,1433;Database=TrainHub360;...` is SQL Server (MSSQL), while this repo targets Postgres via Drizzle. Options:
- Use the bundled Postgres service (default, recommended).
- For MSSQL: run the schema through a MSSQL driver (e.g. `mssql`/`tedious`) or migrate tables; do NOT put the SA password in git — use `DATABASE_URL` / secret manager env vars.

## API
Spec: `lib/api-spec/openapi.yaml`. Regenerate clients:
```
pnpm --filter @workspace/api-spec run codegen
```

## Testing
```
pnpm --filter @workspace/api run test
```

## Docs
See `documents/corporate-training-platform-proposal.md` and `ARCHITECTURE.md`.

