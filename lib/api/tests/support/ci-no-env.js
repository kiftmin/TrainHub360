// CI must never be given a database by accident.
//
// Every database suite loads the repo-root `.env` with dotenv to make local runs work. dotenv
// does not overwrite a variable that is already set — but an *empty* one counts as unset, so
// `DATABASE_URL=""` followed by a `.env` that has a real URL leaves the suite connected. That
// makes "does CI fail without a database?" untestable by hand: the run goes green and looks
// like the guard is broken.
//
// This file is preloaded by `test:ci`. It deletes DATABASE_URL before any suite loads, so the
// .env file cannot supply one either — the run then exercises the no-database path for real
// and fails loudly.
//
// Caveat worth knowing: `node --test` gives each test file its own process and the preload
// runs in that child, so a file that loads .env itself (as every database suite does) will
// still connect. This is a guard for the "did I actually unset it?" question, not a sandbox.
const FROM_ENV_FILE = ["DATABASE_URL", "JWT_SECRET", "PORT", "SEED_ADMIN_EMAIL"];

for (const name of FROM_ENV_FILE) {
  if (process.env[name]) delete process.env[name];
}

if (process.env.DATABASE_URL) {
  console.error("[test:ci] DATABASE_URL is still set from the shell — unset it to exercise the CI guard.");
  process.exit(1);
}
