// Simple in-memory login throttle (per account and per IP). A distributed
// deployment should replace this with a shared store, but the semantics are the
// same: after too many failures the endpoint returns the same generic 401 as a
// wrong password so lockout state is not disclosed.
interface Bucket {
  failures: number;
  firstAt: number;
}

const buckets = new Map<string, Bucket>();
const WINDOW_MS = 15 * 60 * 1000;
const ACCOUNT_LIMIT = 5;
const IP_LIMIT = 40;

function keyOf(scope: "account" | "ip", value: string) {
  return `${scope}:${value}`;
}

function current(k: string, now: number): Bucket | null {
  const b = buckets.get(k);
  if (!b) return null;
  if (now - b.firstAt > WINDOW_MS) {
    buckets.delete(k);
    return null;
  }
  return b;
}

export function loginKeys(ip: string | undefined, email: string | undefined): string[] {
  const keys: string[] = [];
  if (email) keys.push(keyOf("account", email.trim().toLowerCase()));
  if (ip) keys.push(keyOf("ip", ip));
  return keys;
}

export function isLoginLocked(keys: string[], now = Date.now()): boolean {
  for (const k of keys) {
    const b = current(k, now);
    if (!b) continue;
    const limit = k.startsWith("account:") ? ACCOUNT_LIMIT : IP_LIMIT;
    if (b.failures >= limit) return true;
  }
  return false;
}

export function recordLoginFailure(keys: string[], now = Date.now()): void {
  for (const k of keys) {
    const b = current(k, now);
    if (b) b.failures += 1;
    else buckets.set(k, { failures: 1, firstAt: now });
  }
}

export function clearLoginFailures(keys: string[]): void {
  for (const k of keys) buckets.delete(k);
}

export function resetLoginThrottleForTests(): void {
  buckets.clear();
}
