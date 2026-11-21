// Absolute links for anything sent outside the app (email bodies, notification links).
//
// Everything used to emit root-relative paths like "/activate?token=…", which are useless
// in an email: the recipient has no origin to resolve them against. APP_BASE_URL is the one
// place that decides the origin.
//
// [CONFIRM] 2026-11-19: the spec does not say what APP_BASE_URL should be in production, so
// the default is the Vite dev server (http://localhost:5173) — the address the app is
// actually served from in development. Set APP_BASE_URL to the real origin before deploying;
// leaving the default in production would send activation links to localhost.
const DEFAULT_BASE_URL = "http://localhost:5173";

/** The configured origin, with any trailing slash removed. Never ends in "/". */
export function appBaseUrl(): string {
  const raw = (process.env.APP_BASE_URL ?? "").trim();
  return (raw || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

/**
 * Turns a path (or an already-absolute URL) into a link that works from an email.
 * Passes through absolute http(s) URLs unchanged so callers can be careless.
 */
export function appUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${appBaseUrl()}${suffix}`;
}
