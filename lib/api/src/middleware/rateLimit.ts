// Simple in-memory login throttle (per account and per IP). A distributed
// deployment should replace this with a shared store, but the semantics are the
// same: after too many failures the endpoint returns the same generic 401 as a
// wrong password so lockout state is not disclosed.
//
// Round 7 gap 8: this used to be switched off wholesale under NODE_ENV=test, so no test
// ever exercised it. The switch is gone. What is configurable now is the limits and the
// window — an integration test can lower them and turn the throttle on for one case
// (configureLoginThrottle) and restore them afterwards, which is what
// tests/login-throttle.test.js does.
interface Bucket {
  failures: number;
  firstAt: number;
}

export interface LoginThrottleConfig {
  windowMs: number;
  accountLimit: number;
  ipLimit: number;
  /** When false the throttle records nothing and never locks. Only tests should set this. */
  enabled: boolean;
}

const DEFAULTS: LoginThrottleConfig = {
  windowMs: 15 * 60 * 1000,
  accountLimit: 5,
  ipLimit: 40,
  enabled: true,
};

function fromEnv(env: NodeJS.ProcessEnv): Partial<LoginThrottleConfig> {
  const out: Partial<LoginThrottleConfig> = {};
  const num = (value: string | undefined) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const window = num(env.LOGIN_THROTTLE_WINDOW_MS);
  const account = num(env.LOGIN_THROTTLE_ACCOUNT_LIMIT);
  const ip = num(env.LOGIN_THROTTLE_IP_LIMIT);
  if (window !== undefined) out.windowMs = window;
  if (account !== undefined) out.accountLimit = account;
  if (ip !== undefined) out.ipLimit = ip;
  if (env.LOGIN_THROTTLE_ENABLED !== undefined) out.enabled = String(env.LOGIN_THROTTLE_ENABLED).toLowerCase() !== "false";
  return out;
}

let config: LoginThrottleConfig = { ...DEFAULTS, ...fromEnv(process.env) };

const buckets = new Map<string, Bucket>();

export function loginThrottleConfig(): LoginThrottleConfig {
  return { ...config };
}

/** Overrides the limits/window (tests, or a deployment reading them from env at boot). */
export function configureLoginThrottle(partial: Partial<LoginThrottleConfig>): void {
  config = { ...config, ...partial };
  buckets.clear();
}

/** Restores the defaults plus whatever the environment says. */
export function resetLoginThrottleConfig(): void {
  config = { ...DEFAULTS, ...fromEnv(process.env) };
  buckets.clear();
}

function keyOf(scope: "account" | "ip", value: string) {
  return `${scope}:${value}`;
}

function current(k: string, now: number): Bucket | null {
  const b = buckets.get(k);
  if (!b) return null;
  if (now - b.firstAt > config.windowMs) {
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
  if (!config.enabled) return false;
  for (const k of keys) {
    const b = current(k, now);
    if (!b) continue;
    const limit = k.startsWith("account:") ? config.accountLimit : config.ipLimit;
    if (b.failures >= limit) return true;
  }
  return false;
}

export function recordLoginFailure(keys: string[], now = Date.now()): void {
  if (!config.enabled) return;
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

/**
 * Kept for the existing suites, which call it before asserting a successful login.
 * It no longer turns the throttle off for the whole run (gap 8): with the throttle live,
 * a file that fires several failed logins from 127.0.0.1 would otherwise share one IP
 * bucket with every other file in the same process. Clearing the buckets is enough.
 */
export function loginThrottleDisabledForTests(): boolean {
  return !config.enabled;
}
