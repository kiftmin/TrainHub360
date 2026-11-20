// Round 7 / A.2 gaps — one test per gap, so "closed" means "fails if it regresses".
//
//   1. the console sender prints the body and the links (dev activation/reset are usable)
//   2. production refuses to start with a console sender or a localhost APP_BASE_URL
//   3. a failed send is logged and recorded in email_failures, not swallowed
//   4. the reset link works end to end through /auth/reset-password (frontend covered by
//      frontend/src/a2-gaps.test.tsx)
//   5. GET /users exposes activatedAt to org staff, and resend-activation works and is
//      org-scoped
//   6. the badge count comes from GET /notifications?unread=true&limit=1 without the list
//   7. a name with markup is escaped in the activation email
//   8. the login throttle locks out after N failures and a success clears it
import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { hashPassword } from "../dist/services/password.js";
import { signToken } from "../dist/middleware/auth.js";
import { requireDatabase } from "./support/requireDatabase.js";
import { seedRoles } from "./support/seedRoles.js";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env") });

const stamp = Date.now();

describe("A.2 gap 1 — the console sender logs the body and its links", () => {
  test("prints the text, including an absolute link, outside production", async () => {
    const { consoleEmailSender } = await import("../dist/services/email.js");
    const lines = [];
    const original = console.log;
    console.log = (...args) => lines.push(args.join(" "));
    try {
      await consoleEmailSender.send({
        to: "dev@example.com",
        subject: "Activate your TrainHub360 account",
        text: "Hello Dev, activate here: https://app.example.com/activate?token=abc123",
      });
    } finally {
      console.log = original;
    }
    const printed = lines.join("\n");
    assert.match(printed, /dev@example\.com/, "recipient is printed");
    assert.match(printed, /https:\/\/app\.example\.com\/activate\?token=abc123/, "the link is printed, not just the subject");
    assert.match(printed, /Hello Dev/, "the body is printed");
  });
});

describe("A.2 gap 2 — production refuses to start on a misconfigured email path", () => {
  const env = (over) => ({ NODE_ENV: "production", APP_BASE_URL: "https://training.example.com", EMAIL_PROVIDER: "smtp", SMTP_HOST: "smtp.example.com", ...over });

  test("a complete configuration passes", async () => {
    const { emailConfigurationProblems, assertEmailConfiguration } = await import("../dist/services/email.js");
    assert.deepEqual(emailConfigurationProblems(env()), []);
    assert.doesNotThrow(() => assertEmailConfiguration(env()));
  });

  test("production with the console sender throws", async () => {
    const { assertEmailConfiguration } = await import("../dist/services/email.js");
    assert.throws(() => assertEmailConfiguration(env({ EMAIL_PROVIDER: "" })), /EMAIL_PROVIDER/);
  });

  test("production with a localhost APP_BASE_URL throws", async () => {
    const { assertEmailConfiguration } = await import("../dist/services/email.js");
    assert.throws(() => assertEmailConfiguration(env({ APP_BASE_URL: "http://localhost:5173" })), /APP_BASE_URL/);
    assert.throws(() => assertEmailConfiguration(env({ APP_BASE_URL: "" })), /APP_BASE_URL/);
  });

  test("production with smtp but no SMTP_HOST throws", async () => {
    const { assertEmailConfiguration } = await import("../dist/services/email.js");
    assert.throws(() => assertEmailConfiguration(env({ SMTP_HOST: "" })), /SMTP_HOST/);
  });

  test("EMAIL_STRICT=false is the deliberate opt-out", async () => {
    const { assertEmailConfiguration } = await import("../dist/services/email.js");
    assert.doesNotThrow(() => assertEmailConfiguration(env({ EMAIL_PROVIDER: "", EMAIL_STRICT: "false" })));
  });

  test("development only warns", async () => {
    const { assertEmailConfiguration } = await import("../dist/services/email.js");
    const problems = assertEmailConfiguration(env({ NODE_ENV: "development", EMAIL_PROVIDER: "" }));
    assert.equal(problems.length, 1);
  });
});

describe("A.2 gap 7 — a name with markup is escaped in the activation email", () => {
  test("the HTML body carries the escaped name and no injected markup", async () => {
    const { setEmailSender } = await import("../dist/services/email.js");
    const { sendActivationEmail } = await import("../dist/services/password.js");
    process.env.APP_BASE_URL = "https://training.example.com";
    const sent = [];
    setEmailSender({ async send(m) { sent.push(m); return true; } });
    try {
      await sendActivationEmail("victim@example.com", `<a href="https://evil.example">click</a>`, "tok-1");
    } finally {
      setEmailSender(null);
      delete process.env.APP_BASE_URL;
    }
    assert.equal(sent.length, 1);
    assert.ok(!sent[0].html.includes("<a href=\"https://evil.example\">"), "the injected anchor must not survive");
    assert.match(sent[0].html, /&lt;a href=&quot;https:\/\/evil\.example&quot;&gt;/, "it is escaped instead");
  });
});

describe("A.2 gaps 3, 5, 6 — email failures, activation status, unread count", () => {
  let app;
  let server;
  let baseUrl = "";
  let prisma;
  const ids = {
    org: `a2-org-${stamp}`,
    otherOrg: `a2-org-other-${stamp}`,
    staff: `a2-staff-${stamp}@example.com`,
    invitee: `a2-invitee-${stamp}@example.com`,
    outsider: `a2-outsider-${stamp}@example.com`,
    otherStaff: `a2-otherstaff-${stamp}@example.com`,
  };
  const tokens = {};

  const authed = (token, method, p, body) =>
    fetch(`${baseUrl}/api${p}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000),
    });

  before(async () => {
    if (!requireDatabase("a2-gaps.test.js")) return;
    process.env.NODE_ENV = "test";
    ({ default: app } = await import("../dist/index.js"));
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      await prisma.$disconnect();
      prisma = null;
      return;
    }
    await seedRoles(prisma, ["owner", "admin", "trainer", "learner", "stakeholder"]);
    const pw = await hashPassword("pw-a2");
    await prisma.organization.createMany({
      data: [
        { id: ids.org, name: "A2 Org" },
        { id: ids.otherOrg, name: "A2 Other Org" },
      ],
    });
    const mk = (orgId, email, name) => prisma.user.create({ data: { orgId, name, email, passwordHash: pw } });
    const staff = await mk(ids.org, ids.staff, "A2 Staff");
    const invitee = await mk(ids.org, ids.invitee, "A2 Invitee");
    const outsider = await mk(ids.otherOrg, ids.outsider, "A2 Outsider");
    const otherStaff = await mk(ids.otherOrg, ids.otherStaff, "A2 Other Staff");
    await prisma.userRole.create({ data: { userId: staff.id, roleId: "admin", programmeId: null } });
    await prisma.userRole.create({ data: { userId: invitee.id, roleId: "learner", programmeId: null } });
    await prisma.userRole.create({ data: { userId: otherStaff.id, roleId: "admin", programmeId: null } });
    ids.inviteeId = invitee.id;
    ids.outsiderId = outsider.id;
    tokens.staff = signToken({ id: staff.id, role: "admin", orgId: ids.org, tokenVersion: 0 });
    tokens.otherStaff = signToken({ id: otherStaff.id, role: "admin", orgId: ids.otherOrg, tokenVersion: 0 });
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (prisma) {
      await prisma.emailFailure.deleteMany({ where: { to: { contains: `a2-` } } }).catch(() => null);
      const userIds = (await prisma.user.findMany({ where: { orgId: { in: [ids.org, ids.otherOrg] } }, select: { id: true } }).catch(() => [])).map((u) => u.id);
      await prisma.notification.deleteMany({ where: { userId: { in: userIds } } }).catch(() => null);
      await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } }).catch(() => null);
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } }).catch(() => null);
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: { in: [ids.org, ids.otherOrg] } } }).catch(() => null);
      await prisma.$disconnect();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  test("gap 3: a failed send is recorded in email_failures", async (t) => {
    if (!prisma) return t.skip("database unreachable");
    const { setEmailSender } = await import("../dist/services/email.js");
    const { sendActivationEmail } = await import("../dist/services/password.js");
    setEmailSender({ async send() { throw new Error("SMTP connection refused"); } });
    let ok;
    try {
      ok = await sendActivationEmail(`a2-fail-${stamp}@example.com`, "Fail Person", "tok-x");
    } finally {
      setEmailSender(null);
    }
    assert.equal(ok, false, "the caller is told the send failed");
    const row = await prisma.emailFailure.findFirst({ where: { to: `a2-fail-${stamp}@example.com` }, orderBy: { createdAt: "desc" } });
    assert.ok(row, "the failure is recorded, not swallowed");
    assert.equal(row.kind, "activation");
    assert.match(row.error, /SMTP connection refused/);
  });

  test("gap 5: GET /users reports who has not activated, to org staff only", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await authed(tokens.staff, "GET", "/users?limit=100");
    assert.equal(res.status, 200);
    const rows = await res.json();
    const invitee = rows.find((u) => u.email === ids.invitee);
    const staff = rows.find((u) => u.email === ids.staff);
    assert.ok(invitee, "the invitee is in the directory");
    assert.equal(invitee.activatedAt, null, "not activated yet");
    assert.ok("activatedAt" in staff, "the field is present for every row, not just invitees");
  });

  test("gap 5: resend-activation works, is org-scoped, and 409s once activated", async (t) => {
    if (!server) return t.skip("database unreachable");
    // Another organization's admin cannot resend for this person.
    const cross = await authed(tokens.otherStaff, "POST", `/users/${ids.inviteeId}/resend-activation`);
    assert.equal(cross.status, 404, "cross-org resend is a 404");

    const res = await authed(tokens.staff, "POST", `/users/${ids.inviteeId}/resend-activation`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.emailSent, true);

    await prisma.user.update({ where: { id: ids.inviteeId }, data: { activatedAt: new Date() } });
    const again = await authed(tokens.staff, "POST", `/users/${ids.inviteeId}/resend-activation`);
    assert.equal(again.status, 409, "an activated account is not re-invited");
  });

  test("gap 6: the unread count is available without fetching the list", async (t) => {
    if (!server) return t.skip("database unreachable");
    await prisma.notification.createMany({
      data: [
        { userId: ids.inviteeId, orgId: ids.org, type: "session_invite", title: "A2 unread one", body: null, link: null },
        { userId: ids.inviteeId, orgId: ids.org, type: "session_invite", title: "A2 unread two", body: null, link: null },
      ],
    });
    const inviteeToken = signToken({ id: ids.inviteeId, role: "learner", orgId: ids.org, tokenVersion: 0 });
    const res = await authed(inviteeToken, "GET", "/notifications?unread=true&limit=1");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.unread, 2, "the count is the true unread total");
    assert.equal(body.items.length, 1, "only one row is fetched for the badge");
    assert.equal(body.items[0].readAt, null, "and it is an unread row");
  });
});

describe("A.2 gap 8 — the login throttle is live and tested", () => {
  let app;
  let server;
  let baseUrl = "";
  let prisma;
  const ids = {
    org: `a2t-org-${stamp}`,
    email: `a2t-user-${stamp}@example.com`,
    password: "correct-horse-battery",
  };

  const login = (password) =>
    fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: ids.email, password }),
      signal: AbortSignal.timeout(5000),
    });

  before(async () => {
    if (!requireDatabase("a2-gaps.test.js")) return;
    process.env.NODE_ENV = "test";
    ({ default: app } = await import("../dist/index.js"));
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      await prisma.$disconnect();
      prisma = null;
      return;
    }
    await seedRoles(prisma, ["owner", "admin", "trainer", "learner", "stakeholder"]);
    await prisma.organization.create({ data: { id: ids.org, name: "A2 Throttle Org" } });
    const user = await prisma.user.create({
      data: { orgId: ids.org, name: "A2 Throttle", email: ids.email, passwordHash: await hashPassword(ids.password) },
    });
    await prisma.userRole.create({ data: { userId: user.id, roleId: "learner", programmeId: null } });
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    const { resetLoginThrottleConfig } = await import("../dist/middleware/rateLimit.js");
    resetLoginThrottleConfig();
    if (prisma) {
      const users = await prisma.user.findMany({ where: { orgId: ids.org }, select: { id: true } }).catch(() => []);
      await prisma.userRole.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } }).catch(() => null);
      await prisma.user.deleteMany({ where: { orgId: ids.org } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: ids.org } }).catch(() => null);
      await prisma.$disconnect();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  test("N failures lock the account out, and the correct password is refused too", async (t) => {
    if (!server) return t.skip("database unreachable");
    const { configureLoginThrottle, resetLoginThrottleConfig } = await import("../dist/middleware/rateLimit.js");
    // Round 7 gap 8: this is the test that could not exist while the throttle was switched
    // off wholesale under NODE_ENV=test.
    configureLoginThrottle({ enabled: true, accountLimit: 3, ipLimit: 10_000, windowMs: 60_000 });
    try {
      for (let i = 0; i < 3; i += 1) {
        const r = await login("wrong-password");
        assert.equal(r.status, 401);
        assert.deepEqual(await r.json(), { error: "invalid credentials" }, "no hint that the account is now locked");
      }
      const locked = await login(ids.password);
      assert.equal(locked.status, 401, "the lockout wins over a correct password");
      assert.deepEqual(await locked.json(), { error: "invalid credentials" }, "the lockout response is indistinguishable");
    } finally {
      // Every API test file shares one loopback IP inside one process, so the failures recorded
      // here must not outlive this case: restoring the limits without clearing the buckets left
      // other files' logins locked out (seen as auth.test.js "correct password succeeds" -> 401).
      resetLoginThrottleConfig();
    }
  });

  test("a successful login clears the failures, so a second sign-in still works", async (t) => {
    if (!server) return t.skip("database unreachable");
    const { configureLoginThrottle, resetLoginThrottleConfig } = await import("../dist/middleware/rateLimit.js");
    configureLoginThrottle({ enabled: true, accountLimit: 3, ipLimit: 10_000, windowMs: 60_000 });
    try {
      await login("wrong-password");
      await login("wrong-password");
      const good = await login(ids.password);
      assert.equal(good.status, 200, "below the limit, a correct password signs in");
      await login("wrong-password");
      await login("wrong-password");
      const afterReset = await login(ids.password);
      assert.equal(afterReset.status, 200, "the successful login reset the counter");
    } finally {
      resetLoginThrottleConfig();
    }
  });
});
