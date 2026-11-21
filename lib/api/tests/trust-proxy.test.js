// Round 8 / 3.2 — the login throttle keys one bucket on the caller's IP, so the address it
// sees has to be the real client when a proxy is in front of the API and an attacker-supplied
// X-Forwarded-For when there is not. These cases pin both halves: no trust proxy, the header is
// ignored; one trusted hop, it is the address.
import { resetTestState } from "./support/resetTestState.js";
import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { parseTrustProxy } from "../dist/config/proxy.js";
import {
  configureLoginThrottle,
  isLoginLocked,
  loginThrottleConfig,
  resetLoginThrottleConfig,
} from "../dist/middleware/rateLimit.js";

const FORGED = "203.0.113.7";
const FORGED_TWO = "198.51.100.9";

let app;
let server;
let baseUrl = "";
let originalTrustProxy;
const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  LOGIN_THROTTLE_ENABLED: process.env.LOGIN_THROTTLE_ENABLED,
  LOGIN_THROTTLE_ALLOW_DISABLE: process.env.LOGIN_THROTTLE_ALLOW_DISABLE,
};

const wrongLogin = (email, forwardedFor) =>
  fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}) },
    body: JSON.stringify({ email, password: "definitely-wrong" }),
  });

// Express may report the IPv4 socket either plainly or as an IPv4-mapped IPv6 address.
const socketLocked = () => isLoginLocked(["ip:127.0.0.1"]) || isLoginLocked(["ip:::ffff:127.0.0.1"]);

describe("TRUST_PROXY and the login throttle", () => {
  before(async () => {
    await resetTestState();
    process.env.NODE_ENV = "test";
    ({ default: app } = await import("../dist/index.js"));
    originalTrustProxy = app.get("trust proxy");
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    app?.set("trust proxy", originalTrustProxy);
    resetLoginThrottleConfig();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  test("the default is off: an unset TRUST_PROXY trusts no header", () => {
    if (process.env.TRUST_PROXY === undefined) {
      assert.equal(originalTrustProxy, false);
    }
    assert.equal(parseTrustProxy(undefined), false);
    assert.equal(parseTrustProxy(""), false);
    assert.equal(parseTrustProxy("false"), false);
    assert.equal(parseTrustProxy("0"), false);
  });

  test("parses hop counts, booleans and proxy names", () => {
    assert.equal(parseTrustProxy("true"), true);
    assert.equal(parseTrustProxy("2"), 2);
    assert.equal(parseTrustProxy("loopback"), "loopback");
    assert.equal(parseTrustProxy("10.0.0.0/8, 172.16.0.0/12"), "10.0.0.0/8, 172.16.0.0/12");
  });

  test("with trust proxy off, a spoofed X-Forwarded-For does not change the bucket", async () => {
    app.set("trust proxy", false);
    configureLoginThrottle({ enabled: true, ipLimit: 1, accountLimit: 1000, windowMs: 60_000 });

    const res = await wrongLogin("proxy-off@example.com", FORGED);
    assert.equal(res.status, 401);
    assert.equal(socketLocked(), true, "the socket address is what got throttled");
    assert.equal(isLoginLocked([`ip:${FORGED}`]), false, "the forged address must not own a bucket");
  });

  test("with one trusted hop, different forwarded addresses get different buckets", async () => {
    app.set("trust proxy", 1);
    configureLoginThrottle({ enabled: true, ipLimit: 1, accountLimit: 1000, windowMs: 60_000 });

    const first = await wrongLogin("proxy-on-one@example.com", FORGED);
    assert.equal(first.status, 401);
    assert.equal(isLoginLocked([`ip:${FORGED}`]), true);
    assert.equal(socketLocked(), false, "the proxy's own address must not be the bucket");

    // A different forwarded address is a different bucket: the first one being locked must not
    // lock this one out, or every client behind the proxy would share one bucket.
    const second = await wrongLogin("proxy-on-two@example.com", FORGED_TWO);
    assert.equal(second.status, 401);
    assert.equal(isLoginLocked([`ip:${FORGED_TWO}`]), true);
  });

  test("production refuses to disable the throttle without a deliberate opt-out", () => {
    process.env.NODE_ENV = "production";
    process.env.LOGIN_THROTTLE_ENABLED = "false";
    delete process.env.LOGIN_THROTTLE_ALLOW_DISABLE;
    resetLoginThrottleConfig();
    assert.equal(loginThrottleConfig().enabled, true);

    process.env.LOGIN_THROTTLE_ALLOW_DISABLE = "true";
    resetLoginThrottleConfig();
    assert.equal(loginThrottleConfig().enabled, false);
  });
});
