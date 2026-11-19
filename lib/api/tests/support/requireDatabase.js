// Module F.1: a database test must never skip silently.
//
// Every database-backed suite starts with `if (!process.env.DATABASE_URL) return;` and
// each test guards with `if (!server) return t.skip("database unreachable")`. That is right
// for a developer without a database, but it is dangerous in CI: the suite goes green while
// most of it never ran. CI=true therefore turns a missing DATABASE_URL into a hard failure,
// and locally the reason is printed once so a skip list is never mistaken for coverage.
let warned = false;

export function requireDatabase(testName) {
  if (process.env.DATABASE_URL) return true;
  if (process.env.CI === "true" || process.env.CI === "1") {
    throw new Error(
      `${testName}: DATABASE_URL is not set. CI must run the API suite against a real SQL Server ` +
        `(see .github/workflows/ci.yml); refusing to report a green run with skipped database tests.`,
    );
  }
  if (!warned) {
    warned = true;
    console.warn(
      "[tests] DATABASE_URL is not set — database-backed tests will be SKIPPED. " +
        "Set DATABASE_URL (see README) to run them, or CI=true to turn this into a failure.",
    );
  }
  return false;
}
