const fs = require("node:fs");
const path = require("node:path");

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const candidates = [
    path.join(__dirname, "..", "..", "..", ".env"),
    path.join(__dirname, "..", ".env"),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const parsed = {};
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      parsed[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
    if (parsed.DATABASE_URL) return parsed.DATABASE_URL;
  }
  return undefined;
}

async function main() {
  const url = loadDatabaseUrl();
  if (!url) {
    throw new Error("DATABASE_URL is not set and no .env was found with it");
  }
  process.env.DATABASE_URL = url;
  const { verifySchema } = await import("../../api/dist/services/schemaVerification.js");
  const missing = await verifySchema();
  if (missing.length) {
    console.error(`schema verification failed; missing ${missing.join("; ")}`);
    process.exitCode = 1;
    return;
  }
  console.log("schema verification passed: all migration-only objects are present");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
