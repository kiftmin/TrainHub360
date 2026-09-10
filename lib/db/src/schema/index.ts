// Prisma is now the source of truth: see lib/db/prisma/schema.prisma.
// This barrel re-exports Prisma types so existing `import ... from "@workspace/db/schema"` keeps working.
export * from "@prisma/client";

