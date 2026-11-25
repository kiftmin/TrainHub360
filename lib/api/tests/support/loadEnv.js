// Load the repo-root .env before any other module is evaluated.
//
// The suites call dotenv themselves, but that runs *after* their static imports. Those imports
// pull in `@workspace/db`, and Prisma's client loads the `.env` next to the schema (lib/db/.env)
// while doing so. dotenv never overwrites an existing value, so the root URL would lose and the
// suite would silently run against the schema's database instead of the one documented in the
// README. Preloading this file with `node --import` (see package.json) makes the root `.env`
// authoritative, while a DATABASE_URL exported by CI still wins.
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", ".env") });
process.env.EMAIL_PROVIDER = "console";
process.env.NODE_ENV = "test";
