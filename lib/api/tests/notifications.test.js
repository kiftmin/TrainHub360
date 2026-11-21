// A.2: the notification bell's endpoints, the SMTP/console sender switch, and absolute
// links in outbound mail.
import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { requireDatabase } from "./support/requireDatabase.js";
import { seedRoles } from "./support/seedRoles.js";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env") });

const stamp = Date.now();

describe("notification bell", () => {
  if (!requireDatabase("notifications.test.js")) return;
  let app;
  let server;
  let baseUrl = "";
  let prisma;
  let ids = {};

  before(async () => {
    process.env.NODE_ENV = "test";
    ({ default: app } = await import("../dist/index.js"));
    const { PrismaClient } = await import("@prisma/client");
    const { hashPassword } = await import("../dist/services/password.js");
    prisma = new PrismaClient();
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      await prisma.$disconnect();
      prisma = null;
      return;
    }
    await seedRoles(prisma);
    const pw = await hashPassword("pw-notifications");
    const org = await prisma.organization.create({ data: { id: `ntf-org-${stamp}`, name: "Notification Org" } });
    const programme = await prisma.programme.create({ data: { id: `ntf-prog-${stamp}`, name: "Notification Prog", orgId: org.id, type: "compliance", status: "active", owner: "Ntf Owner" } });
    const owner = await prisma.user.create({ data: { id: `ntf-owner-${stamp}`, orgId: org.id, name: "Ntf Owner", email: `ntf-owner-${stamp}@example.com`, passwordHash: pw } });
    const other = await prisma.user.create({ data: { id: `ntf-other-${stamp}`, orgId: org.id, name: "Ntf Other", email: `ntf-other-${stamp}@example.com`, passwordHash: pw } });
    await prisma.userRole.create({ data: { id: `ntf-ur-${stamp}`, userId: owner.id, roleId: "owner", programmeId: programme.id } });
    await prisma.userRole.create({ data: { id: `ntf-ur2-${stamp}`, userId: other.id, roleId: "learner", programmeId: programme.id } });
    ids = { org: org.id, programme: programme.id, owner: owner.id, other: other.id, pw: "pw-notifications" };
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (prisma) {
      await prisma.notification.deleteMany({ where: { userId: { in: [ids.owner, ids.other].filter(Boolean) } } }).catch(() => null);
      await prisma.userRole.deleteMany({ where: { userId: { in: [ids.owner, ids.other].filter(Boolean) } } }).catch(() => null);
      await prisma.user.deleteMany({ where: { id: { in: [ids.owner, ids.other].filter(Boolean) } } }).catch(() => null);
      await prisma.programme.deleteMany({ where: { id: ids.programme } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: ids.org } }).catch(() => null);
      await prisma.$disconnect();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  const login = async (email) => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: ids.pw }),
    });
    assert.equal(res.status, 200, `login ${email} -> ${res.status}`);
    return (await res.json()).accessToken;
  };
  const authed = (token, method, url, body) =>
    fetch(`${baseUrl}/api${url}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000),
    });

  test("a user sees only their own notifications, newest first", async (t) => {
    if (!server) return t.skip("database unreachable");
    const ownerToken = await login(`ntf-owner-${stamp}@example.com`);
    await prisma.notification.createMany({
      data: [
        { id: `ntf-a-${stamp}`, userId: ids.owner, orgId: ids.org, type: "session_invite", title: "Invitation: Safety", body: "Mon 10:00", link: "/calendar" },
        { id: `ntf-b-${stamp}`, userId: ids.owner, orgId: ids.org, type: "certificate_expiring", title: "Certificate expiring", body: null, link: null },
        { id: `ntf-c-${stamp}`, userId: ids.other, orgId: ids.org, type: "session_invite", title: "Someone else's", body: null, link: null },
      ],
    });
    const res = await authed(ownerToken, "GET", "/notifications");
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.items.length >= 2, "owner sees their own two");
    assert.ok(!data.items.some((n) => n.userId === ids.other), "another user's notification must never appear");
    assert.equal(data.unread, data.items.filter((n) => !n.readAt).length, "unread count matches the list");
  });

  test("marking one read is scoped to the caller", async (t) => {
    if (!server) return t.skip("database unreachable");
    const ownerToken = await login(`ntf-owner-${stamp}@example.com`);
    const otherToken = await login(`ntf-other-${stamp}@example.com`);

    const mine = await authed(ownerToken, "POST", `/notifications/ntf-a-${stamp}/read`);
    assert.equal(mine.status, 200);
    const row = await prisma.notification.findUnique({ where: { id: `ntf-a-${stamp}` } });
    assert.ok(row.readAt, "readAt set on the caller's own notification");

    // The same id, from the other user, must not touch it and must 404.
    const theirs = await authed(otherToken, "POST", `/notifications/ntf-b-${stamp}/read`);
    assert.equal(theirs.status, 404, "another user's notification id is not readable");
    const untouched = await prisma.notification.findUnique({ where: { id: `ntf-b-${stamp}` } });
    assert.equal(untouched.readAt, null, "cross-user read attempt changed nothing");
  });

  test("read-all only touches the caller's unread rows", async (t) => {
    if (!server) return t.skip("database unreachable");
    const ownerToken = await login(`ntf-owner-${stamp}@example.com`);
    const res = await authed(ownerToken, "POST", "/notifications/read-all");
    assert.equal(res.status, 200);
    const ownerUnread = await prisma.notification.count({ where: { userId: ids.owner, readAt: null } });
    const otherUnread = await prisma.notification.count({ where: { userId: ids.other, readAt: null } });
    assert.equal(ownerUnread, 0);
    assert.equal(otherUnread, 1, "the other user's notification is untouched");
  });
});

describe("email sender selection", () => {
  test("defaults to the console sender", async () => {
    delete process.env.EMAIL_PROVIDER;
    const { emailProviderName, getEmailSender, consoleEmailSender } = await import("../dist/services/email.js");
    assert.equal(emailProviderName(), "console");
    assert.equal(getEmailSender(), consoleEmailSender);
  });

  test("smtp without SMTP_HOST throws instead of silently using the console", async () => {
    process.env.EMAIL_PROVIDER = "smtp";
    delete process.env.SMTP_HOST;
    const { emailProviderName, getEmailSender } = await import("../dist/services/email.js");
    assert.equal(emailProviderName(), "smtp");
    await assert.rejects(() => getEmailSender().send({ to: "x@example.com", subject: "s", text: "t" }), /SMTP_HOST/);
    delete process.env.EMAIL_PROVIDER;
  });

  test("an explicitly set sender wins over the provider", async () => {
    const { setEmailSender, getEmailSender } = await import("../dist/services/email.js");
    const sent = [];
    setEmailSender({ async send(m) { sent.push(m); return true; } });
    await getEmailSender().send({ to: "y@example.com", subject: "s", text: "t" });
    setEmailSender(null);
    assert.equal(sent.length, 1);
  });
});

describe("absolute links in outbound mail", () => {
  test("appUrl joins APP_BASE_URL and a path, and strips a trailing slash", async () => {
    const { appBaseUrl, appUrl } = await import("../dist/services/links.js");
    process.env.APP_BASE_URL = "https://training.example.com/";
    assert.equal(appBaseUrl(), "https://training.example.com");
    assert.equal(appUrl("/activate?token=abc"), "https://training.example.com/activate?token=abc");
    assert.equal(appUrl("reset-password?token=abc"), "https://training.example.com/reset-password?token=abc");
    assert.equal(appUrl("https://other.example.com/x"), "https://other.example.com/x", "absolute URLs pass through");
    delete process.env.APP_BASE_URL;
  });

  test("the activation email carries an absolute link", async () => {
    const { setEmailSender } = await import("../dist/services/email.js");
    const { sendActivationEmail } = await import("../dist/services/password.js");
    process.env.APP_BASE_URL = "https://training.example.com";
    const sent = [];
    setEmailSender({ async send(m) { sent.push(m); return true; } });
    await sendActivationEmail("new@example.com", "New Person", "tok-123");
    setEmailSender(null);
    delete process.env.APP_BASE_URL;
    assert.equal(sent.length, 1);
    assert.match(sent[0].text, /https:\/\/training\.example\.com\/activate\?token=tok-123/);
    assert.match(sent[0].html ?? "", /href="https:\/\/training\.example\.com\/activate\?token=tok-123"/);
    assert.ok(!/(^|\s)\/activate\?/.test(sent[0].text), "no root-relative link is left in the text");
  });
});
