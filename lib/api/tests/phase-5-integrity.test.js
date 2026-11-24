// Round 8 / Phase 5 — content integrity, memberships and the smaller fixes.
//
//   E.1 progress state machine: forwards only, pending verification is frozen for the learner,
//       and a reversed move is a 409.
//   E.2 verification queue and verify: programme-scoped by grant, one decision per item.
//   E.3 a withdrawn learner is refused content, progress, attempt start and attempt submit.
//   E.5 thread participation is soft-revoked and restored on re-add; one who stays removed does
//       not get it back.
//   B.1 bookings by identity: an unrelated trainer is refused.
//   E.7 waitlist promotion follows waitlistedAt, not the overwritten respondedAt; capacity is a
//       positive whole number or null.
//   E.8/9 upload signature check and provider host boundary.
//   E.10 an ambiguous PATCH (toRole without fromRole on a multi-grant member) is a 400.
//
// Every test here fails if the corresponding fix is reverted.
import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { resetTestState } from "./support/resetTestState.js";
import { hashPassword } from "../dist/services/password.js";
import { signToken } from "../dist/middleware/auth.js";
import { requireDatabase } from "./support/requireDatabase.js";
import { seedRoles } from "./support/seedRoles.js";
import { providerForUrl } from "../dist/services/contentProgress.js";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env") });

const stamp = Date.now();
let app;
let server;
let baseUrl;
let prisma;
let storageDir;

const ids = {
  org: `p5-org-${stamp}`,
  progA: `p5-prog-a-${stamp}`,
  progB: `p5-prog-b-${stamp}`,
  courseA: `p5-course-a-${stamp}`,
  courseB: `p5-course-b-${stamp}`,
  moduleA: `p5-module-a-${stamp}`,
};
const t = {};

async function freshToken(key, orgId, role = "learner") {
  const row = await prisma.user.findUnique({ where: { id: t[`${key}Id`] }, select: { tokenVersion: true } });
  return signToken({ id: t[`${key}Id`], role, orgId, tokenVersion: row?.tokenVersion ?? 0 });
}

async function api(pathname, { method = "GET", token, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${baseUrl}${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, json, text };
}

describe("Phase 5 — content integrity, memberships and smaller fixes", () => {
  before(async () => {
    await resetTestState();
    if (!requireDatabase("phase-5-integrity.test.js")) return;
    process.env.NODE_ENV = "test";
    storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "p5-storage-"));
    process.env.STORAGE_DIR = storageDir;
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
    const pw = await hashPassword("pw-p5");
    await prisma.organization.create({ data: { id: ids.org, name: "P5 Org" } });

    const mkUser = async (key, name) => {
      const u = await prisma.user.create({ data: { orgId: ids.org, name, email: `p5-${key}-${stamp}@example.com`, passwordHash: pw } });
      t[`${key}Id`] = u.id;
      return u;
    };
    const grant = (userId, role, programmeId = null) => prisma.userRole.create({ data: { userId, roleId: role, programmeId } });

    await mkUser("orgAdmin", "Org Admin"); // org-level admin (isOrgStaff)
    await grant(t.orgAdminId, "admin");
    await mkUser("progAdmin", "Prog Admin");
    await grant(t.progAdminId, "admin", ids.progA);
    // trainerA holds two grants in progA, which is what makes a bare toRole ambiguous.
    await mkUser("trainerA", "Trainer A");
    await grant(t.trainerAId, "trainer", ids.progA);
    await grant(t.trainerAId, "admin", ids.progA);
    // trainerB is a real trainer, but of another programme: an unrelated trainer for bookings.
    await mkUser("trainerB", "Trainer B");
    await grant(t.trainerBId, "trainer", ids.progB);
    for (const key of ["learnerA", "learner2", "learner3"]) {
      await mkUser(key, key);
      await grant(t[`${key}Id`], "learner", ids.progA);
    }

    await prisma.programme.createMany({
      data: [
        { id: ids.progA, orgId: ids.org, name: "P5 Programme A", type: "Test", owner: "Prog Admin" },
        { id: ids.progB, orgId: ids.org, name: "P5 Programme B", type: "Test", owner: "Org Admin" },
      ],
    });
    await prisma.course.createMany({
      data: [
        { id: ids.courseA, programmeId: ids.progA, title: "P5 Course A" },
        { id: ids.courseB, programmeId: ids.progB, title: "P5 Course B" },
      ],
    });
    await prisma.module.create({ data: { id: ids.moduleA, courseId: ids.courseA, title: "P5 Module" } });
    await prisma.enrolment.createMany({
      data: ["learnerA", "learner2", "learner3"].map((key) => ({
        id: `p5-enr-${key}-${stamp}`, learnerId: t[`${key}Id`], courseId: ids.courseA, programmeId: ids.progA, status: "enrolled",
      })),
    });
    t.enrolmentAId = `p5-enr-learnerA-${stamp}`;

    // A published assessment with one objective question, so attempts can be started and
    // submitted without going through the builder UI.
    const assessment = await prisma.assessment.create({
      data: { moduleId: ids.moduleA, type: "recall", title: "P5 Quiz", passMark: 70, isPublished: true, publishedAt: new Date() },
    });
    const question = await prisma.question.create({
      data: { assessmentId: assessment.id, kind: "single_choice", prompt: "2 + 2?", points: 1, order: 1 },
    });
    await prisma.questionOption.createMany({
      data: [
        { questionId: question.id, text: "4", isCorrect: true, order: 1 },
        { questionId: question.id, text: "5", isCorrect: false, order: 2 },
      ],
    });
    t.assessmentId = assessment.id;

    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (prisma) {
      const orgId = ids.org;
      await prisma.sessionRSVP.deleteMany({ where: { session: { orgId } } }).catch(() => null);
      await prisma.session.deleteMany({ where: { orgId } }).catch(() => null);
      await prisma.booking.deleteMany({ where: { orgId } }).catch(() => null);
      await prisma.message.deleteMany({ where: { thread: { orgId } } }).catch(() => null);
      await prisma.threadParticipant.deleteMany({ where: { thread: { orgId } } }).catch(() => null);
      await prisma.messageThread.deleteMany({ where: { orgId } }).catch(() => null);
      await prisma.contentProgress.deleteMany({ where: { contentItem: { moduleId: ids.moduleA } } }).catch(() => null);
      await prisma.contentItem.deleteMany({ where: { moduleId: ids.moduleA } }).catch(() => null);
      await prisma.assessmentAttempt.deleteMany({ where: { assessment: { moduleId: ids.moduleA } } }).catch(() => null);
      await prisma.assessment.deleteMany({ where: { moduleId: ids.moduleA } }).catch(() => null);
      await prisma.enrolment.deleteMany({ where: { programme: { orgId } } }).catch(() => null);
      await prisma.module.deleteMany({ where: { courseId: { in: [ids.courseA, ids.courseB] } } }).catch(() => null);
      await prisma.course.deleteMany({ where: { id: { in: [ids.courseA, ids.courseB] } } }).catch(() => null);
      await prisma.programme.deleteMany({ where: { orgId } }).catch(() => null);
      const users = await prisma.user.findMany({ where: { orgId }, select: { id: true } }).catch(() => []);
      const userIds = users.map((u) => u.id);
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } }).catch(() => null);
      await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } }).catch(() => null);
      await prisma.storedFile.deleteMany({ where: { orgId } }).catch(() => null);
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => null);
      await prisma.$disconnect();
    }
    if (storageDir) await fs.rm(storageDir, { recursive: true, force: true }).catch(() => null);
  });

  test("E.1 — a learner cannot move progress backwards", async (tst) => {
    if (!server) return tst.skip("database unreachable");
    const created = await api(`/api/modules/${ids.moduleA}/content`, {
      method: "POST", token: await freshToken("progAdmin", ids.org, "admin"),
      body: { type: "native", title: "Read me", body: "read", required: false },
    });
    assert.equal(created.status, 201, created.text);
    t.readItemId = created.json.id;
    const learner = await freshToken("learnerA", ids.org);

    const started = await api(`/api/content/${t.readItemId}/progress`, { method: "POST", token: learner, body: { status: "in_progress" } });
    assert.equal(started.status, 200, started.text);
    assert.equal(started.json.status, "in_progress");

    const back = await api(`/api/content/${t.readItemId}/progress`, { method: "POST", token: learner, body: { status: "not_started" } });
    assert.equal(back.status, 409, "in progress cannot return to not started");
    assert.match(back.json.error, /in progress back to not started/);

    const done = await api(`/api/content/${t.readItemId}/progress`, { method: "POST", token: learner, body: { status: "completed" } });
    assert.equal(done.status, 200, done.text);
    assert.equal(done.json.status, "completed");
    t.readProgressId = done.json.id;

    const reverse = await api(`/api/content/${t.readItemId}/progress`, { method: "POST", token: learner, body: { status: "in_progress" } });
    assert.equal(reverse.status, 409, "a completed item cannot be moved backwards");
    assert.match(reverse.json.error, /moved backwards/);
  });

  test("E.1/E.2 — verification needs evidence, freezes the learner, and is decided once", async (tst) => {
    if (!server) return tst.skip("database unreachable");
    const admin = await freshToken("progAdmin", ids.org, "admin");
    const created = await api(`/api/modules/${ids.moduleA}/content`, {
      method: "POST", token: admin,
      body: { type: "external_link", title: "Watch this", url: "https://example.com/watch", completionMode: "trainer_verified", required: false },
    });
    assert.equal(created.status, 201, created.text);
    t.watchItemId = created.json.id;
    const learner = await freshToken("learnerA", ids.org);

    const noEvidence = await api(`/api/content/${t.watchItemId}/progress`, { method: "POST", token: learner, body: { status: "completed" } });
    assert.equal(noEvidence.status, 400, "completion without a note or file is refused");

    const submitted = await api(`/api/content/${t.watchItemId}/progress`, {
      method: "POST", token: learner, body: { status: "completed", evidenceNote: "Watched the whole thing" },
    });
    assert.equal(submitted.status, 200, submitted.text);
    assert.equal(submitted.json.status, "pending_verification");
    assert.equal(submitted.json.completedAt, null, "completion only counts once verified");
    t.watchProgressId = submitted.json.id;

    const whilePending = await api(`/api/content/${t.watchItemId}/progress`, { method: "POST", token: learner, body: { status: "in_progress" } });
    assert.equal(whilePending.status, 409, "the learner cannot edit an item awaiting verification");

    // The queue is scoped by grant: the programme trainer sees it, the other programme's trainer
    // sees an empty queue, and a plain learner is refused.
    const queue = await api("/api/content-progress/pending", { token: await freshToken("trainerA", ids.org, "trainer") });
    assert.equal(queue.status, 200, queue.text);
    assert.ok(queue.json.some((r) => r.id === t.watchProgressId), "the programme trainer sees the row");
    const otherQueue = await api("/api/content-progress/pending", { token: await freshToken("trainerB", ids.org, "trainer") });
    assert.equal(otherQueue.status, 200);
    assert.equal(otherQueue.json.some((r) => r.id === t.watchProgressId), false, "a trainer of another programme does not");
    const learnerQueue = await api("/api/content-progress/pending", { token: learner });
    assert.equal(learnerQueue.status, 403);

    const unrelated = await api(`/api/content-progress/${t.watchProgressId}/verify`, {
      method: "POST", token: await freshToken("trainerB", ids.org, "trainer"), body: { verified: true },
    });
    assert.equal(unrelated.status, 403, "a trainer outside the programme cannot verify");

    const verified = await api(`/api/content-progress/${t.watchProgressId}/verify`, {
      method: "POST", token: await freshToken("trainerA", ids.org, "trainer"), body: { verified: true, note: "Looks right" },
    });
    assert.equal(verified.status, 200, verified.text);
    assert.equal(verified.json.status, "completed");
    assert.equal(verified.json.verifiedBy, t.trainerAId);
    assert.ok(verified.json.verifiedAt);

    const again = await api(`/api/content-progress/${t.watchProgressId}/verify`, {
      method: "POST", token: await freshToken("trainerA", ids.org, "trainer"), body: { verified: true },
    });
    assert.equal(again.status, 409, "an item is decided once");

    const nonPending = await api(`/api/content-progress/${t.readProgressId}/verify`, {
      method: "POST", token: await freshToken("trainerA", ids.org, "trainer"), body: { verified: true },
    });
    assert.equal(nonPending.status, 409, "a self-reported completion is not in the queue");

    const behind = await api(`/api/content/${t.watchItemId}/progress`, { method: "POST", token: learner, body: { status: "in_progress" } });
    assert.equal(behind.status, 409, "a verified completed item cannot be moved backwards");
    assert.match(behind.json.error, /verified item/);
  });

  test("E.3 — a withdrawn learner is refused content, progress, attempt start and submit", async (tst) => {
    if (!server) return tst.skip("database unreachable");
    const admin = await freshToken("progAdmin", ids.org, "admin");
    const created = await api(`/api/modules/${ids.moduleA}/content`, {
      method: "POST", token: admin, body: { type: "native", title: "Last read", body: "read", required: false },
    });
    assert.equal(created.status, 201, created.text);
    t.lastItemId = created.json.id;

    // Start an attempt while eligible, then withdraw: submitting must still be refused.
    const started = await api(`/api/assessments/${t.assessmentId}/attempts`, { method: "POST", token: await freshToken("learnerA", ids.org) });
    assert.equal(started.status, 201, started.text);
    const attemptId = started.json.attemptId;

    const withdrawn = await api(`/api/enrolments/${t.enrolmentAId}`, {
      method: "PATCH", token: admin, body: { status: "withdrawn", reason: "Withdrawn by staff for the test" },
    });
    assert.equal(withdrawn.status, 200, withdrawn.text);

    const learner = await freshToken("learnerA", ids.org);
    const content = await api(`/api/courses/${ids.courseA}/content`, { token: learner });
    assert.equal(content.status, 403, "course content requires a live enrolment");
    const progress = await api(`/api/content/${t.lastItemId}/progress`, { method: "POST", token: learner, body: { status: "in_progress" } });
    assert.equal(progress.status, 403, "progress writes require a live enrolment");
    const startAgain = await api(`/api/assessments/${t.assessmentId}/attempts`, { method: "POST", token: learner });
    assert.equal(startAgain.status, 403, "a withdrawn learner cannot start an assessment");
    const submit = await api(`/api/attempts/${attemptId}/submit`, { method: "POST", token: learner, body: { answers: [] } });
    assert.equal(submit.status, 403, "an attempt started earlier cannot be submitted after withdrawal");

    // Reinstate for the later tests.
    const restored = await api(`/api/enrolments/${t.enrolmentAId}`, {
      method: "PATCH", token: admin, body: { status: "enrolled", reason: "Reinstated after the withdrawal test" },
    });
    assert.equal(restored.status, 200, restored.text);
  });

  test("E.5 — a re-added member regains thread access; one who stays removed does not", async (tst) => {
    if (!server) return tst.skip("database unreachable");
    const admin = await freshToken("progAdmin", ids.org, "admin");
    const created = await api("/api/threads", {
      method: "POST", token: admin,
      body: { subject: "P5 thread", programmeId: ids.progA, participantIds: [t.learnerAId, t.learner2Id], body: "hello" },
    });
    assert.equal(created.status, 201, created.text);
    const threadId = created.json.id;

    // Remove both participants from the programme.
    for (const key of ["learnerA", "learner2"]) {
      const removed = await api(`/api/programmes/${ids.progA}/members/${t[`${key}Id`]}`, { method: "DELETE", token: admin });
      assert.equal(removed.status, 200, removed.text);
    }
    const revokedA = await prisma.threadParticipant.findFirst({ where: { threadId, userId: t.learnerAId } });
    assert.ok(revokedA, "the participation row is kept for audit");
    assert.ok(revokedA.leftAt, "revoking sets leftAt instead of deleting the row");

    const goneForA = await api(`/api/threads/${threadId}/messages`, { token: await freshToken("learnerA", ids.org) });
    assert.equal(goneForA.status, 404, "a removed member loses the thread");

    // Re-add only learnerA. The learner grant coming back (and the enrolment it reinstates) must
    // restore the participation they had before the removal.
    const readded = await api(`/api/programmes/${ids.progA}/members`, {
      method: "POST", token: admin, body: { userId: t.learnerAId, roles: ["learner"] },
    });
    assert.equal(readded.status, 201, readded.text);
    const enrolmentA = await prisma.enrolment.findFirst({ where: { learnerId: t.learnerAId, programmeId: ids.progA } });
    assert.notEqual(enrolmentA.status, "withdrawn", "re-adding the learner grant reinstates the enrolment");

    const backForA = await api(`/api/threads/${threadId}/messages`, { token: await freshToken("learnerA", ids.org) });
    assert.equal(backForA.status, 200, backForA.text);
    const listForA = await api("/api/threads", { token: await freshToken("learnerA", ids.org) });
    assert.ok(listForA.json.some((th) => th.id === threadId), "the restored thread is listed again");
    const restoredRow = await prisma.threadParticipant.findFirst({ where: { threadId, userId: t.learnerAId } });
    assert.equal(restoredRow.leftAt, null, "restoring clears leftAt");
    assert.equal(restoredRow.leftReason, null);

    // learner2 was not re-added, so their participation stays revoked.
    const stillGone = await api(`/api/threads/${threadId}/messages`, { token: await freshToken("learner2", ids.org) });
    assert.equal(stillGone.status, 404, "a member who stays removed keeps no access");
    const listFor2 = await api("/api/threads", { token: await freshToken("learner2", ids.org) });
    assert.equal(listFor2.json.some((th) => th.id === threadId), false);
    const row2 = await prisma.threadParticipant.findFirst({ where: { threadId, userId: t.learner2Id } });
    assert.ok(row2.leftAt);
  });

  test("B.1 — bookings are by identity and refuse an unrelated trainer", async (tst) => {
    if (!server) return tst.skip("database unreachable");
    const learner = await freshToken("learnerA", ids.org);
    const trainers = await api("/api/bookings/trainers", { token: learner });
    assert.equal(trainers.status, 200, trainers.text);
    const offered = trainers.json.map((x) => x.id);
    assert.ok(offered.includes(t.trainerAId), "the programme's trainer is bookable");
    assert.equal(offered.includes(t.trainerBId), false, "another programme's trainer is not");

    const unrelated = await api("/api/bookings", {
      method: "POST", token: learner, body: { trainerId: t.trainerBId, date: "2026-12-01", time: "10:00" },
    });
    assert.equal(unrelated.status, 403, "a trainer outside the learner's programmes is refused");

    const booked = await api("/api/bookings", {
      method: "POST", token: learner, body: { trainerId: t.trainerAId, courseId: ids.courseA, date: "2026-12-01", time: "10:00" },
    });
    assert.equal(booked.status, 400, "learners must book a generated availability slot");

    const staffView = await api("/api/bookings/trainers", { token: await freshToken("orgAdmin", ids.org, "admin") });
    const staffIds = staffView.json.map((x) => x.id);
    assert.ok(staffIds.includes(t.trainerAId) && staffIds.includes(t.trainerBId), "org staff see every trainer");

    const noId = await api("/api/bookings", { method: "POST", token: learner, body: { trainer: "Trainer A", date: "2026-12-01", time: "10:00" } });
    assert.equal(noId.status, 400, "a name is no longer a booking identity");
  });

  test("E.7 — waitlist promotion follows waitlistedAt, not the overwritten respondedAt", async (tst) => {
    if (!server) return tst.skip("database unreachable");
    const admin = await freshToken("progAdmin", ids.org, "admin");
    const created = await api("/api/sessions", {
      method: "POST", token: admin,
      body: {
        title: "P5 Waitlist", programmeId: ids.progA, courseId: ids.courseA, mode: "online",
        joinUrl: "https://meet.example.com/p5", date: "2026-12-10", time: "10:00", capacity: 1,
      },
    });
    assert.equal(created.status, 201, created.text);
    const sessionId = created.json.id;
    assert.equal(created.json.capacity, 1);

    const now = Date.now();
    const at = (minutesAgo) => new Date(now - minutesAgo * 60_000);
    await prisma.sessionRSVP.createMany({
      data: [
        // The confirmed learner frees the only seat.
        { sessionId, learnerId: t.learnerAId, status: "confirmed", respondedAt: at(30), createdAt: at(30) },
        // learner2 joined the queue first, but responded most recently.
        { sessionId, learnerId: t.learner2Id, status: "waitlisted", waitlistedAt: at(10), respondedAt: at(2), createdAt: at(30) },
        // learner3 joined later, but their respondedAt is older: the old sort would pick them.
        { sessionId, learnerId: t.learner3Id, status: "waitlisted", waitlistedAt: at(5), respondedAt: at(20), createdAt: at(30) },
      ],
    });

    const declined = await api(`/api/sessions/${sessionId}/rsvp`, { method: "POST", token: await freshToken("learnerA", ids.org), body: { status: "declined" } });
    assert.equal(declined.status, 200, declined.text);

    const promoted = await prisma.sessionRSVP.findFirst({ where: { sessionId, learnerId: t.learner2Id } });
    assert.equal(promoted.status, "confirmed", "the earliest waitlistedAt is promoted");
    assert.equal(promoted.waitlistedAt, null);
    const notPromoted = await prisma.sessionRSVP.findFirst({ where: { sessionId, learnerId: t.learner3Id } });
    assert.equal(notPromoted.status, "waitlisted", "the later waitlistedAt stays on the queue");
  });

  test("E.7 — capacity is a positive whole number or null", async (tst) => {
    if (!server) return tst.skip("database unreachable");
    const admin = await freshToken("progAdmin", ids.org, "admin");
    const base = { title: "P5 Capacity", programmeId: ids.progA, mode: "online", joinUrl: "https://meet.example.com/cap", date: "2026-12-11", time: "10:00" };
    for (const capacity of [0, -3, 1.5, "abc"]) {
      const bad = await api("/api/sessions", { method: "POST", token: admin, body: { ...base, capacity } });
      assert.equal(bad.status, 400, `capacity ${JSON.stringify(capacity)} is refused`);
    }
    const good = await api("/api/sessions", { method: "POST", token: admin, body: { ...base, capacity: 2 } });
    assert.equal(good.status, 201, good.text);
    assert.equal(good.json.capacity, 2);

    const zero = await api(`/api/sessions/${good.json.id}`, { method: "PATCH", token: admin, body: { capacity: 0 } });
    assert.equal(zero.status, 400, "an update cannot shrink the count to zero");
    const unlimited = await api(`/api/sessions/${good.json.id}`, { method: "PATCH", token: admin, body: { capacity: null } });
    assert.equal(unlimited.status, 200, unlimited.text);
    assert.equal(unlimited.json.capacity, null);
  });

  test("E.8 — a renamed executable is not accepted as a PDF", async (tst) => {
    if (!server) return tst.skip("database unreachable");
    const learner = await freshToken("learnerA", ids.org);
    const upload = async (bytes, name, type) => {
      const form = new FormData();
      form.append("file", new Blob([bytes], { type }), name);
      const res = await fetch(`${baseUrl}/api/uploads/evidence`, { method: "POST", headers: { authorization: `Bearer ${learner}` }, body: form });
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = null; }
      return { status: res.status, json, text };
    };

    const exe = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(64, 0x90)]);
    const disguised = await upload(exe, "notes.pdf", "application/pdf");
    assert.equal(disguised.status, 400, disguised.text);
    assert.match(disguised.json.error, /do not match the declared type/);

    const pngAsJpeg = await upload(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]), "photo.jpg", "image/jpeg");
    assert.equal(pngAsJpeg.status, 400, "a PNG is not a JPEG");

    const real = await upload(Buffer.from("%PDF-1.7\n% evidence\n"), "notes.pdf", "application/pdf");
    assert.equal(real.status, 201, real.text);
    assert.equal(real.json.mimeType, "application/pdf");
  });

  test("E.9 — provider detection matches the domain or a real subdomain only", () => {
    assert.equal(providerForUrl("https://www.coursera.org/learn/x"), "coursera");
    assert.equal(providerForUrl("https://coursera.org"), "coursera");
    assert.equal(providerForUrl("https://evilcoursera.org/x"), "other", "a look-alike suffix is not Coursera");
    assert.equal(providerForUrl("https://coursera.org.evil.com/x"), "other");
    assert.equal(providerForUrl("https://learning.linkedin.com/x"), "linkedin_learning");
    assert.equal(providerForUrl("https://notlinkedin.com/x"), "other");
    assert.equal(providerForUrl("https://www.udemy.com/course/x"), "udemy");
    assert.equal(providerForUrl("https://udemy.com.evil.io"), "other");
    assert.equal(providerForUrl("not a url"), "other");
  });

  test("E.10 — a bare toRole on a multi-grant member is an ambiguous 400", async (tst) => {
    if (!server) return tst.skip("database unreachable");
    const before = await prisma.userRole.count({ where: { userId: t.trainerAId, programmeId: ids.progA } });
    assert.equal(before, 2, "the member holds two grants in the programme");

    const ambiguous = await api(`/api/programmes/${ids.progA}/members/${t.trainerAId}`, {
      method: "PATCH", token: await freshToken("progAdmin", ids.org, "admin"), body: { toRole: "learner" },
    });
    assert.equal(ambiguous.status, 400, ambiguous.text);
    assert.match(ambiguous.json.error, /fromRole is required/);

    const unchanged = await prisma.userRole.count({ where: { userId: t.trainerAId, programmeId: ids.progA } });
    assert.equal(unchanged, 2, "the refused PATCH changed nothing");
  });

  test("E.10 — the first thread message stores the author's name, not their role", async (tst) => {
    if (!server) return tst.skip("database unreachable");
    const created = await api("/api/threads", {
      method: "POST", token: await freshToken("learnerA", ids.org),
      body: { subject: "Who wrote this", programmeId: ids.progA, participantIds: [t.trainerAId], body: "hi" },
    });
    assert.equal(created.status, 201, created.text);
    const message = await prisma.message.findFirst({ where: { threadId: created.json.id }, orderBy: { createdAt: "asc" } });
    assert.equal(message.author, "learnerA", "the stored author is the person, not \"learner\"");
  });
});
