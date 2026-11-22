// Round 8 / 3.2 — the login throttle keys its IP bucket on `req.ip`. Express only trusts
// `X-Forwarded-For` when `trust proxy` is set, so the default is off: a caller cannot choose
// their own bucket by sending a header. Behind a real proxy the operator sets TRUST_PROXY to
// the hop count (e.g. 1), `loopback`, or a CIDR list — the formats Express accepts.
export function parseTrustProxy(value: string | undefined): boolean | number | string {
  const raw = (value ?? "").trim();
  if (!raw || raw.toLowerCase() === "false" || raw === "0") return false;
  if (raw.toLowerCase() === "true") return true;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}
