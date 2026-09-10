# TrainHub360

Corporate training platform proving training worked, not just that it happened.

## Database: SQL Server
`lib/db/prisma/schema.prisma` targets your MSSQL instance via Prisma (`provider = "sqlserver"`).

1. Copy env template: `cp .env.example .env` and set the real SA password in `DATABASE_URL`:
   `sqlserver://69.30.247.60:1433;database=TrainHub360;user=sa;password=<SECRET>;trustServerCertificate=true`
2. Generate + push schema:
   `pnpm --filter @workspace/db run prisma:generate`
   `pnpm --filter @workspace/db run prisma:push`
3. Run API: `PORT=4000 pnpm --filter @workspace/api run dev`
4. Health: `GET /api/healthz` (liveness) · `GET /api/readyz` (includes MSSQL `SELECT 1` check)

Never commit `.env` or the SA password — it is gitignored. CI uses a placeholder URL.

## API
Spec: `lib/api-spec/openapi.yaml`. Regenerate clients:
`pnpm --filter @workspace/api-spec run codegen`

## Docs
See `documents/corporate-training-platform-proposal.md` and `ARCHITECTURE.md`.

