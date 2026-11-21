// Round 8 / 3.1: process-level state that survives from one test to the next.
//
// The login throttle is in memory and keyed partly by IP. Every suite that starts the app
// talks to it from 127.0.0.1, so a file that deliberately fails logins (auth, a2-gaps) can
// otherwise leave the per-IP bucket full for the next case in the same process. Suite files
// run one at a time (see --test-concurrency in package.json), so clearing here is enough:
// there is no other process to race with.
//
// Call this at the top of `before()` in any suite that logs in. Anything else that turns out
// to be process-level later belongs here too, so the suites do not each grow their own reset.
export async function resetTestState() {
  const { resetLoginThrottleForTests } = await import("../../dist/middleware/rateLimit.js");
  resetLoginThrottleForTests();
}
