import { PrismaClient, Prisma } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

export * from "@prisma/client";

// Round 6 / A.1: the error middleware needs the generated Prisma error class to tell a
// database outage (P1001/P1002/P1017 -> 503) from a programming error (-> 500). Re-exported
// here because the API must not import "@prisma/client" directly: a second PrismaClient
// module instance would bypass the singleton above and exhaust the SQL Server connection
// pool when the suite runs many test files in parallel.
export { Prisma };
