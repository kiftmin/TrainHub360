import { resetTestState } from "./support/resetTestState.js";
import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { signToken } from "../dist/middleware/auth.js";
import { requireDatabase } from "./support/requireDatabase.js";
import { seedRoles } from "./support/seedRoles.js";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env") });

describe("programme-scoped course and module authoring", () => {
  let app;
  let server;
  let baseUrl = "";
  let prisma;
  const stamp = Date.now();
  const ids = {
    orgA: `authoring-org-a-${stamp}`,
    orgB: `authoring-org-b-${stamp}`,
    progA: `authoring-prog-a-${stamp}`,
    progUngranted: `authoring-prog-ungranted-${stamp}`,
    progB: `authoring-prog-b-${stamp}`,
    courseA: `authoring-course-a-${stamp}`,
    courseUngranted: `authoring-course-ungranted-${stamp}`,
    courseB: `authoring-course-b-${stamp}`,
    moduleA: `authoring-module-a-${stamp}`,
  };
  const userIds = {};
  const tokens = {};

  const mkUser = async (key, email, name) => {
    const user = await prisma.user.create({ data: { orgId: ids.orgA, name, email } });
    userIds[key] = user.id;
    return user.id;
  };
  const grant = (userId, roleId, programmeId) => prisma.userRole.create({ data: { userId, roleId, programmeId } });

  before(async () => {
    await resetTestState();
    if (!requireDatabase("programme-content-authoring.test.js")) return;
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

    await prisma.organization.createMany({
      data: [
        { id: ids.orgA, name: "Authoring Org A" },
        { id: ids.orgB, name: "Authoring Org B" },
      ],
    });
    await seedRoles(prisma, ["owner", "admin", "trainer", "learner", "stakeholder"]);
    await prisma.programme.createMany({
      data: [
        { id: ids.progA, orgId: ids.orgA, name: "Assigned", type: "Test", owner: "Owner" },
        { id: ids.progUngranted, orgId: ids.orgA, name: "Ungranted", type: "Test", owner: "Owner" },
        { id: ids.progB, orgId: ids.orgB, name: "Other org", type: "Test", owner: "Owner" },
      ],
    });
    await prisma.course.createMany({
      data: [
        { id: ids.courseA, programmeId: ids.progA, title: "Assigned course", category: "General" },
        { id: ids.courseUngranted, programmeId: ids.progUngranted, title: "Ungranted course", category: "General" },
        { id: ids.courseB, programmeId: ids.progB, title: "Other org course", category: "General" },
      ],
    });
    await prisma.module.create({ data: { id: ids.moduleA, courseId: ids.courseA, title: "Seed module" } });

    await mkUser("trainer", `authoring-trainer-${stamp}@example.com`, "Assigned Trainer");
    await mkUser("multiTrainer", `authoring-multi-${stamp}@example.com`, "Multi Trainer");
    await mkUser("admin", `authoring-admin-${stamp}@example.com`, "Programme Admin");
    await mkUser("owner", `authoring-owner-${stamp}@example.com`, "Org Owner");
    await mkUser("learner", `authoring-learner-${stamp}@example.com`, "Learner");
    await mkUser("assignedTrainer", `authoring-assigned-${stamp}@example.com`, "Assigned Person");
    await mkUser("ungrantedTrainer", `authoring-ungranted-${stamp}@example.com`, "Ungranted Person");

    await grant(userIds.trainer, "trainer", ids.progA);
    await grant(userIds.multiTrainer, "trainer", ids.progA);
    await grant(userIds.multiTrainer, "trainer", ids.progUngranted);
    await grant(userIds.admin, "admin", ids.progA);
    await grant(userIds.owner, "owner", null);
    await grant(userIds.learner, "learner", ids.progA);
    await grant(userIds.assignedTrainer, "trainer", ids.progA);

    const tokenFor = (key, role) => signToken({ id: userIds[key], role, orgId: ids.orgA, tokenVersion: 0 });
    tokens.trainer = tokenFor("trainer", "trainer");
    tokens.multiTrainer = tokenFor("multiTrainer", "trainer");
    tokens.admin = tokenFor("admin", "admin");
    tokens.owner = tokenFor("owner", "owner");
    tokens.learner = tokenFor("learner", "learner");
    tokens.ungranted = tokenFor("ungrantedTrainer", "trainer");

    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (prisma) {
      const courseIds = (await prisma.course.findMany({
        where: { programmeId: { in: [ids.progA, ids.progUngranted, ids.progB] } },
        select: { id: true },
      })).map((c) => c.id);
      await prisma.module.deleteMany({ where: { courseId: { in: courseIds } } }).catch(() => null);
      await prisma.course.deleteMany({ where: { programmeId: { in: [ids.progA, ids.progUngranted, ids.progB] } } }).catch(() => null);
      await prisma.userRole.deleteMany({ where: { userId: { in: Object.values(userIds) } } }).catch(() => null);
      await prisma.user.deleteMany({ where: { orgId: ids.orgA } }).catch(() => null);
      await prisma.programme.deleteMany({ where: { id: { in: [ids.progA, ids.progUngranted, ids.progB] } } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: { in: [ids.orgA, ids.orgB] } } }).catch(() => null);
      await prisma.$disconnect();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  const authed = (token, method, p, body) => fetch(`${baseUrl}/api${p}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });

  test("an authorised trainer can create a course with a programme-granted trainer", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await authed(tokens.trainer, "POST", "/courses", {
      programmeId: ids.progA,
      title: "Trainer authored",
      category: "Safety",
      trainerId: userIds.assignedTrainer,
    });
    assert.equal(res.status, 201);
    const created = await res.json();
    assert.equal(created.programmeId, ids.progA);
    assert.equal(created.category, "Safety");
    assert.equal(created.trainerId, userIds.assignedTrainer);
    assert.equal(created.trainer, "Assigned Person");
  });

  test("a trainer cannot create a course in an ungranted programme", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await authed(tokens.trainer, "POST", "/courses", { programmeId: ids.progUngranted, title: "Nope" });
    assert.equal(res.status, 403);
  });

  test("a trainer cannot create a course in another organisation", async (t) => {
    if (!server) return t.skip("database unreachable");
    const trainerRes = await authed(tokens.trainer, "POST", "/courses", { programmeId: ids.progB, title: "Nope" });
    assert.equal(trainerRes.status, 403);
    const ownerRes = await authed(tokens.owner, "POST", "/courses", { programmeId: ids.progB, title: "Nope" });
    assert.equal(ownerRes.status, 404);
  });

  test("an authorised programme administrator retains course creation", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await authed(tokens.admin, "POST", "/courses", { programmeId: ids.progA, title: "Admin authored", category: "General" });
    assert.equal(res.status, 201);
  });

  test("course titles are validated and trainer assignment follows programme grants", async (t) => {
    if (!server) return t.skip("database unreachable");
    const missing = await authed(tokens.trainer, "POST", "/courses", { programmeId: ids.progA, category: "General" });
    assert.equal(missing.status, 400);
    const blank = await authed(tokens.trainer, "POST", "/courses", { programmeId: ids.progA, title: "   " });
    assert.equal(blank.status, 400);
    const badTrainer = await authed(tokens.trainer, "POST", "/courses", {
      programmeId: ids.progA,
      title: "Bad assignment",
      trainerId: userIds.ungrantedTrainer,
    });
    assert.equal(badTrainer.status, 400);
    const forged = await authed(tokens.learner, "POST", "/courses", { programmeId: ids.progA, title: "Forged" });
    assert.equal(forged.status, 403);
  });

  test("an authorised trainer can create a module in a course in their programme", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await authed(tokens.trainer, "POST", `/programmes/${ids.progA}/modules`, { courseId: ids.courseA, title: "Trainer module" });
    assert.equal(res.status, 201);
    const created = await res.json();
    assert.equal(created.courseId, ids.courseA);
    assert.equal(created.title, "Trainer module");
  });

  test("a trainer cannot create a module in an unrelated programme", async (t) => {
    if (!server) return t.skip("database unreachable");
    const plain = await authed(tokens.trainer, "POST", `/programmes/${ids.progUngranted}/modules`, { courseId: ids.courseUngranted, title: "Nope" });
    assert.equal(plain.status, 403);
    const spoofedProgramme = await authed(tokens.trainer, "POST", `/programmes/${ids.progUngranted}/modules`, { programmeId: ids.progA, courseId: ids.courseUngranted, title: "Nope" });
    assert.equal(spoofedProgramme.status, 403);
    const spoofedModule = await authed(tokens.trainer, "POST", `/programmes/${ids.progUngranted}/modules`, { moduleId: ids.moduleA, courseId: ids.courseUngranted, title: "Nope" });
    assert.equal(spoofedModule.status, 403);
  });

  test("a module cannot be associated with a course from another programme", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await authed(tokens.multiTrainer, "POST", `/programmes/${ids.progA}/modules`, { courseId: ids.courseUngranted, title: "Mismatch" });
    assert.equal(res.status, 400);
    const crossOrg = await authed(tokens.owner, "POST", `/programmes/${ids.progB}/modules`, { courseId: ids.courseA, title: "Cross org" });
    assert.equal(crossOrg.status, 404);
  });

  test("an authorised programme administrator retains module creation", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await authed(tokens.admin, "POST", `/programmes/${ids.progA}/modules`, { courseId: ids.courseA, title: "Admin module" });
    assert.equal(res.status, 201);
  });

  test("module course associations and titles are validated", async (t) => {
    if (!server) return t.skip("database unreachable");
    const missingCourse = await authed(tokens.trainer, "POST", `/programmes/${ids.progA}/modules`, { title: "No course" });
    assert.equal(missingCourse.status, 400);
    const missingTitle = await authed(tokens.trainer, "POST", `/programmes/${ids.progA}/modules`, { courseId: ids.courseA });
    assert.equal(missingTitle.status, 400);
    const unknownCourse = await authed(tokens.trainer, "POST", `/programmes/${ids.progA}/modules`, { courseId: "authoring-unknown-course", title: "Unknown" });
    assert.equal(unknownCourse.status, 404);
    const forged = await authed(tokens.learner, "POST", `/programmes/${ids.progA}/modules`, { courseId: ids.courseA, title: "Forged" });
    assert.equal(forged.status, 403);
  });
});
