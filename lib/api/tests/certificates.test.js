import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { hashPassword } from "../dist/services/password.js";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env") });

describe("certificates", () => {
  let app;
  let server;
  let baseUrl = "";
  let prisma;
  const stamp = Date.now();
  const ids = {
    org: `cert-org-${stamp}`,
    prog: `cert-prog-${stamp}`,
    course: `cert-course-${stamp}`,
    admin: `cert-admin-${stamp}@example.com`,
    learner: `cert-learner-${stamp}@example.com`,
  };
  let enrolmentId = "";
  let token = "";

  before(async () => {
    if (!process.env.DATABASE_URL) return;
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
    const pw = await hashPassword("pw");
    await prisma.organization.create({ data: { id: ids.org, name: "Cert Org" } });
    for (const r of ["owner", "admin", "trainer", "learner"]) {
      await prisma.role.upsert({ where: { name: r }, create: { id: r, name: r }, update: {} });
    }
    await prisma.programme.create({ data: { id: ids.prog, orgId: ids.org, name: "C Prog", type: "Compliance", owner: "t" } });
    await prisma.course.create({ data: { id: ids.course, programmeId: ids.prog, title: "Safety Basics", category: "Compliance", validityMonths: 12 } });
    const admin = await prisma.user.create({ data: { orgId: ids.org, name: "C Admin", email: ids.admin, passwordHash: pw } });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "owner" } });
    await prisma.userRole.create({ data: { userId: admin.id, roleId: role.id, programmeId: null } });
    const learner = await prisma.user.create({ data: { orgId: ids.org, name: "C Learner", email: ids.learner, passwordHash: pw } });
    const enr = await prisma.enrolment.create({ data: { learnerId: learner.id, courseId: ids.course, programmeId: ids.prog, status: "enrolled" } });
    enrolmentId = enr.id;
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: ids.admin, password: "pw" }),
    });
    token = (await login.json()).accessToken;
  });

  after(async () => {
    if (prisma) {
      await prisma.certificate.deleteMany({ where: { courseId: ids.course } }).catch(() => null);
      await prisma.enrolment.deleteMany({ where: { programmeId: ids.prog } }).catch(() => null);
      await prisma.course.deleteMany({ where: { id: ids.course } }).catch(() => null);
      await prisma.programme.deleteMany({ where: { id: ids.prog } }).catch(() => null);
      const users = await prisma.user.findMany({ where: { orgId: ids.org }, select: { id: true } }).catch(() => []);
      await prisma.userRole.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } }).catch(() => null);
      await prisma.user.deleteMany({ where: { orgId: ids.org } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: ids.org } }).catch(() => null);
      await prisma.$disconnect();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  test("completing a compliance course issues a certificate", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await fetch(`${baseUrl}/api/enrolments/${enrolmentId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ status: "completed" }),
    });
    assert.equal(res.status, 200);
    const cert = await prisma.certificate.findFirst({ where: { enrolmentId } });
    assert.ok(cert, "certificate should be issued");
    assert.equal(cert.status, "active");
    const monthsOut = (cert.expiresAt.getTime() - Date.now()) / (30 * 86400000);
    assert.ok(monthsOut > 10 && monthsOut < 13, "expires ~12 months out");
  });

  test("manual expiry route triggers the job", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await fetch(`${baseUrl}/api/certificates/check-expiry`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ withinDays: 30 }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(typeof data.reminded === "number");
  });

  test("expiry job surfaces near-term certificates and dashboard counts them", async (t) => {
    if (!server) return t.skip("database unreachable");
    const soon = new Date();
    soon.setDate(soon.getDate() + 5);
    await prisma.certificate.updateMany({ where: { enrolmentId }, data: { expiresAt: soon } });
    const { runCertificateExpiryJob } = await import("../dist/jobs/certificateExpiryJob.js");
    const out = await runCertificateExpiryJob(30);
    assert.ok(out.reminded >= 1);
    const summary = await fetch(`${baseUrl}/api/dashboard/summary`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json());
    assert.ok(summary.expiringCredentials >= 1, "dashboard reflects real expiring count");
    assert.ok(summary.expiringItems.length >= 1);
  });
});
