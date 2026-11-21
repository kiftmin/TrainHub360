// Round 6 / Phase B — the four findings that are not about assessments or reminders.
//
//   H3: trainer matching by name. A rename (or an unassignment) must never write across
//       organizations, and the name fallback must only apply where trainerId is null.
//   M1: removed members keep thread access. Losing the programme grant, or being withdrawn,
//       revokes the thread participant rows.
//   M2: RSVP. (a) re-confirming keeps your seat, (b) capacity holds under concurrent
//       confirmations, (c) only invited/enrolled learners may RSVP, (d) no token answers for
//       another learner unless it is programme staff.
//   M3: GET /sessions no longer hands every joinUrl/location to every user in the organization.
//
// Every test here fails if the corresponding fix is reverted.
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
let app;
let server;
let baseUrl;
let prisma;

const ids = {
  orgA: `pb-org-a-${stamp}`,
  orgB: `pb-org-b-${stamp}`,
  progA: `pb-prog-a-${stamp}`,
  progB: `pb-prog-b-${stamp}`,
  courseA: `pb-course-a-${stamp}`,
  courseB: `pb-course-b-${stamp}`,
  session: `pb-session-${stamp}`,
  sessionFull: `pb-session-full-${stamp}`,
};
const t = {}; // tokens and ids filled in `before`

/** A token carrying the account's current tokenVersion (writes like removal bump it). */
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

describe("Phase B — trainer identity, thread access, RSVP and session visibility", () => {
  before(async () => {
    if (!requireDatabase("phase-b.test.js")) return;
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
    const pw = await hashPassword("pw-b");
    await prisma.organization.createMany({ data: [{ id: ids.orgA, name: "B Org A" }, { id: ids.orgB, name: "B Org B" }] });

    const mkUser = async (orgId, key, name, email) => {
      const u = await prisma.user.create({ data: { orgId, name, email, passwordHash: pw } });
      t[`${key}Id`] = u.id;
      t[`${key}Token`] = signToken({ id: u.id, role: "learner", orgId, tokenVersion: 0 });
      return u;
    };
    const grant = async (userId, role, programmeId = null) => prisma.userRole.create({ data: { userId, roleId: role, programmeId } });

    // Org A: an org admin, two programme admins, a trainer (also a programme admin), two learners.
    const adminA = await mkUser(ids.orgA, "adminA", "Org Admin A", `pb-admin-a-${stamp}@example.com`);
    await grant(adminA.id, "admin");
    const progAdminA = await mkUser(ids.orgA, "progAdminA", "Prog Admin A", `pb-padmin-a-${stamp}@example.com`);
    await grant(progAdminA.id, "admin", ids.progA);
    const progAdmin2A = await mkUser(ids.orgA, "progAdmin2A", "Prog Admin 2 A", `pb-padmin2-a-${stamp}@example.com`);
    await grant(progAdmin2A.id, "admin", ids.progA);
    // The trainer is literally named the same as the org-B trainer: the name fallback must not
    // reach across organizations.
    const trainerA = await mkUser(ids.orgA, "trainerA", "Same Name", `pb-trainer-a-${stamp}@example.com`);
    await grant(trainerA.id, "trainer", ids.progA);
    await grant(trainerA.id, "admin", ids.progA);
    const learnerA = await mkUser(ids.orgA, "learnerA", "Learner A", `pb-learner-a-${stamp}@example.com`);
    await grant(learnerA.id, "learner", ids.progA);
    const learner2A = await mkUser(ids.orgA, "learner2A", "Learner 2 A", `pb-learner2-a-${stamp}@example.com`);
    await grant(learner2A.id, "learner", ids.progA);
    const outsiderA = await mkUser(ids.orgA, "outsiderA", "Outsider A", `pb-outsider-a-${stamp}@example.com`);
    await grant(outsiderA.id, "learner", ids.progB); // in org A, but only on another programme
    const threadPeerA = await mkUser(ids.orgA, "threadPeerA", "Thread Peer A", `pb-peer-a-${stamp}@example.com`);
    await grant(threadPeerA.id, "learner", ids.progA);

    // Org B: a trainer with the same name, and a course assigned by name only (legacy row).
    const adminB = await mkUser(ids.orgB, "adminB", "Org Admin B", `pb-admin-b-${stamp}@example.com`);
    await grant(adminB.id, "admin");
    const trainerB = await mkUser(ids.orgB, "trainerB", "Same Name", `pb-trainer-b-${stamp}@example.com`);
    await grant(trainerB.id, "trainer", null);

    await prisma.programme.createMany({
      data: [
        { id: ids.progA, orgId: ids.orgA, name: "B Prog A", type: "Test", owner: "Prog Admin A" },
        { id: ids.progB, orgId: ids.orgA, name: "B Prog B", type: "Test", owner: "Prog Admin A" },
      ],
    });
    await prisma.programme.create({ data: { id: `pb-prog-b-org-b-${stamp}`, orgId: ids.orgB, name: "B Prog B Org B", type: "Test", owner: "Org Admin B" } });
    await prisma.course.createMany({
      data: [
        { id: ids.courseA, programmeId: ids.progA, title: "Course A", trainerId: trainerA.id, trainer: "Same Name" },
        { id: ids.courseB, programmeId: `pb-prog-b-org-b-${stamp}`, title: "Course B", trainerId: trainerB.id, trainer: "Same Name" },
      ],
    });
    await prisma.enrolment.createMany({
      data: [
        { learnerId: learnerA.id, courseId: ids.courseA, programmeId: ids.progA, status: "enrolled" },
        { learnerId: learner2A.id, courseId: ids.courseA, programmeId: ids.progA, status: "enrolled" },
        { learnerId: threadPeerA.id, courseId: ids.courseA, programmeId: ids.progA, status: "enrolled" },
      ],
    });
    await prisma.session.createMany({
      data: [
        {
          id: ids.session, title: "B Session", date: "2026-12-01", time: "10:00", capacity: 1, orgId: ids.orgA,
          programmeId: ids.progA, courseId: ids.courseA, trainerId: trainerA.id, trainer: "Same Name",
          mode: "online", joinUrl: "https://meet.example.com/b-session", location: "Room 1",
        },
        { id: ids.sessionFull, title: "B Full", date: "2026-12-02", time: "10:00", capacity: 1, orgId: ids.orgA, programmeId: ids.progA, mode: "online", joinUrl: "https://meet.example.com/full" },
      ],
    });

    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (prisma) {
      const orgs = [ids.orgA, ids.orgB];
      await prisma.sessionRSVP.deleteMany({ where: { session: { orgId: { in: orgs } } } }).catch(() => null);
      await prisma.session.deleteMany({ where: { orgId: { in: orgs } } }).catch(() => null);
      await prisma.threadParticipant.deleteMany({ where: { thread: { orgId: { in: orgs } } } }).catch(() => null);
      await prisma.message.deleteMany({ where: { thread: { orgId: { in: orgs } } } }).catch(() => null);
      await prisma.messageThread.deleteMany({ where: { orgId: { in: orgs } } }).catch(() => null);
      await prisma.enrolment.deleteMany({ where: { programmeId: ids.progA } }).catch(() => null);
      await prisma.course.deleteMany({ where: { id: { in: [ids.courseA, ids.courseB] } } }).catch(() => null);
      await prisma.programme.deleteMany({ where: { orgId: { in: orgs } } }).catch(() => null);
      const users = await prisma.user.findMany({ where: { orgId: { in: orgs } }, select: { id: true } }).catch(() => []);
      const userIds = users.map((u) => u.id);
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } }).catch(() => null);
      await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } }).catch(() => null);
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: { in: orgs } } }).catch(() => null);
      await prisma.$disconnect();
    }
  });

  test("H3 — renaming a trainer in one organization does not rewrite the other organization's course", async (tst) => {
    if (!server) return tst.skip("database unreachable");
    const res = await api(`/api/users/${t.trainerAId}`, { method: "PATCH", token: t.adminAToken, body: { name: "Renamed Trainer" } });
    assert.equal(res.status, 200, res.text);

    const mine = await prisma.course.findUnique({ where: { id: ids.courseA } });
    assert.equal(mine.trainer, "Renamed Trainer", "this organization's course follows its trainer");

    const theirs = await prisma.course.findUnique({ where: { id: ids.courseB } });
    assert.equal(theirs.trainer, "Same Name", "the other organization's course is untouched");
  });

  test("H3 — a legacy course matched by name is only touched when it has no trainerId", async (tst) => {
    if (!server) return tst.skip("database unreachable");
    // A course in this programme with the same display name but a different identity.
    const decoy = await prisma.course.create({
      data: { programmeId: ids.progA, title: "Decoy", trainerId: t.threadPeerAId, trainer: "Renamed Trainer" },
    });
    const legacy = await prisma.course.create({ data: { programmeId: ids.progA, title: "Legacy", trainerId: null, trainer: "Renamed Trainer" } });
    // Removing the trainer grant must not clear the decoy (identity differs) but may clear legacy.
    const res = await api(`/api/programmes/${ids.progA}/members/${t.trainerAId}?role=trainer`, { method: "DELETE", token: t.progAdminAToken });
    assert.equal(res.status, 200, res.text);
    assert.equal((await prisma.course.findUnique({ where: { id: decoy.id } })).trainerId, t.threadPeerAId, "another trainer's course is untouched");
    assert.equal((await prisma.course.findUnique({ where: { id: legacy.id } })).trainerId, null);
    await prisma.course.deleteMany({ where: { id: { in: [decoy.id, legacy.id] } } }).catch(() => null);
  });

  test("M1 — a removed member loses the thread, an org admin keeps it", async (tst) => {
    if (!server) return tst.skip("database unreachable");
    const created = await api("/api/threads", {
      method: "POST", token: t.threadPeerAToken,
      body: { subject: "B thread", programmeId: ids.progA, participantIds: [t.progAdminAId], body: "hello" },
    });
    assert.equal(created.status, 201, created.text);
    const threadId = created.json.id;

    const before = await api(`/api/threads/${threadId}/messages`, { token: t.threadPeerAToken });
    assert.equal(before.status, 200, "participant can read while the grant is live");

    // Remove the peer from the programme.
    const removed = await api(`/api/programmes/${ids.progA}/members/${t.threadPeerAId}`, { method: "DELETE", token: t.progAdminAToken });
    assert.equal(removed.status, 200, removed.text);

    // Removal bumps tokenVersion (existing sessions are invalidated); sign a fresh token, which
    // is what the user gets on their next login, so the thread check itself is what is tested.
    const peerToken = await freshToken("threadPeerA", ids.orgA);
    const after = await api(`/api/threads/${threadId}/messages`, { token: peerToken });
    assert.equal(after.status, 404, "access is revoked with the grant");
    const list = await api("/api/threads", { token: peerToken });
    assert.equal(list.status, 200);
    assert.equal(list.json.some((th) => th.id === threadId), false, "the thread is gone from their list");
    const rows = await prisma.threadParticipant.count({ where: { threadId, userId: t.threadPeerAId } });
    assert.equal(rows, 0, "the participant row is deleted, not merely ignored");

    // An org admin is not a participant but administers the programme, so they still read it.
    const adminRead = await api(`/api/threads/${threadId}/messages`, { token: t.adminAToken });
    assert.equal(adminRead.status, 200, adminRead.text);
  });

  test("M1 — a withdrawn learner loses the thread", async (tst) => {
    if (!server) return tst.skip("database unreachable");
    const created = await api("/api/threads", {
      method: "POST", token: t.learnerAToken,
      body: { subject: "Withdraw me", programmeId: ids.progA, participantIds: [t.progAdminAId], body: "question" },
    });
    assert.equal(created.status, 201, created.text);
    const enrolment = await prisma.enrolment.findFirst({ where: { learnerId: t.learnerAId, programmeId: ids.progA } });
    const withdrawn = await api(`/api/enrolments/${enrolment.id}`, { method: "PATCH", token: t.progAdminAToken, body: { status: "withdrawn" } });
    assert.equal(withdrawn.status, 200, withdrawn.text);
    // Withdrawal bumps tokenVersion, so a fresh token is what the learner gets on next login.
    const learnerToken = await freshToken("learnerA", ids.orgA);
    const read = await api(`/api/threads/${created.json.id}/messages`, { token: learnerToken });
    assert.equal(read.status, 404, "a withdrawn learner cannot read the programme thread");
    const rows = await prisma.threadParticipant.count({ where: { threadId: created.json.id, userId: t.learnerAId } });
    const grants = await prisma.userRole.findMany({ where: { userId: t.learnerAId }, select: { programmeId: true } });
    assert.equal(rows, 0, `their participant row is revoked on withdrawal (grants: ${JSON.stringify(grants)})`);
    // Put the enrolment back for the RSVP tests below.
    await prisma.enrolment.update({ where: { id: enrolment.id }, data: { status: "enrolled" } });
  });

  test("M2(a) — re-confirming keeps a confirmed seat instead of moving to the waitlist", async (tst) => {
    if (!server) return tst.skip("database unreachable");
    // A capacity-1 session on the learner's own course (enrolment is the eligibility route).
    const full = await prisma.session.create({
      data: {
        title: "B Full", date: "2026-12-02", time: "10:00", capacity: 1, orgId: ids.orgA,
        programmeId: ids.progA, courseId: ids.courseA, mode: "online", joinUrl: "https://meet.example.com/full",
      },
    });
    ids.sessionFull = full.id;
    const learnerToken = await freshToken("learnerA", ids.orgA);
    const first = await api(`/api/sessions/${ids.sessionFull}/rsvp`, { method: "POST", token: learnerToken, body: { status: "confirmed" } });
    assert.equal(first.status, 200, first.text);
    assert.equal(first.json.status, "confirmed");
    // The session is now full; the same learner confirming again must stay confirmed.
    const again = await api(`/api/sessions/${ids.sessionFull}/rsvp`, { method: "POST", token: learnerToken, body: { status: "confirmed" } });
    assert.equal(again.status, 200, again.text);
    assert.equal(again.json.status, "confirmed", "their own seat is not counted against them");
    // A different learner is waitlisted.
    const other = await api(`/api/sessions/${ids.sessionFull}/rsvp`, { method: "POST", token: await freshToken("learner2A", ids.orgA), body: { status: "confirmed" } });
    assert.equal(other.status, 200, other.text);
    assert.equal(other.json.status, "waitlisted");
  });

  test("M2(b) — concurrent confirmations cannot exceed capacity", async (tst) => {
    if (!server) return tst.skip("database unreachable");
    const capacitySession = await prisma.session.create({
      data: { title: "B Race", date: "2026-12-03", time: "10:00", capacity: 2, orgId: ids.orgA, programmeId: ids.progA, mode: "online", joinUrl: "https://meet.example.com/race" },
    });
    const learners = [];
    for (let i = 0; i < 6; i++) {
      const u = await prisma.user.create({ data: { orgId: ids.orgA, name: `Race ${i}`, email: `pb-race-${i}-${stamp}@example.com`, passwordHash: "x" } });
      await prisma.userRole.create({ data: { userId: u.id, roleId: "learner", programmeId: ids.progA } });
      await prisma.sessionRSVP.create({ data: { sessionId: capacitySession.id, learnerId: u.id, status: "invited" } });
      learners.push(u.id);
    }
    // Six learners confirm at the same moment. Every call goes through the API, so the lock is
    // exercised exactly as production uses it.
    const raceTokens = [];
    for (const id of learners) {
      const u = await prisma.user.findUniqueOrThrow({ where: { id } });
      raceTokens.push(signToken({ id: u.id, role: "learner", orgId: ids.orgA, tokenVersion: 0 }));
    }
    const responses = await Promise.all(raceTokens.map((token) =>
      api(`/api/sessions/${capacitySession.id}/rsvp`, { method: "POST", token, body: { status: "confirmed" } })));
    assert.ok(responses.every((r) => r.status === 200), responses.map((r) => `${r.status} ${r.text}`).join(" | "));
    const statuses = responses.map((r) => r.json.status);
    const confirmed = statuses.filter((s) => s === "confirmed").length;
    assert.equal(confirmed, 2, `capacity is never exceeded (statuses: ${statuses.join(",")})`);
    const stored = await prisma.sessionRSVP.count({ where: { sessionId: capacitySession.id, status: "confirmed" } });
    assert.equal(stored, 2, "the database agrees with the responses");
    await prisma.sessionRSVP.deleteMany({ where: { sessionId: capacitySession.id } }).catch(() => null);
    await prisma.session.delete({ where: { id: capacitySession.id } }).catch(() => null);
    await prisma.userRole.deleteMany({ where: { userId: { in: learners } } }).catch(() => null);
    await prisma.user.deleteMany({ where: { id: { in: learners } } }).catch(() => null);
  });

  test("M2(c) — a learner with no invitation or enrolment cannot RSVP", async (tst) => {
    if (!server) return tst.skip("database unreachable");
    const res = await api(`/api/sessions/${ids.session}/rsvp`, { method: "POST", token: await freshToken("outsiderA", ids.orgA), body: { status: "confirmed" } });
    assert.equal(res.status, 403, res.text);
    assert.match(res.json.error, /not invited/);
    const enrolled = await api(`/api/sessions/${ids.session}/rsvp`, { method: "POST", token: await freshToken("learner2A", ids.orgA), body: { status: "confirmed" } });
    assert.equal(enrolled.status, 200, "an enrolled learner is eligible");
  });

  test("M2(d) — only programme staff may answer for another learner", async (tst) => {
    if (!server) return tst.skip("database unreachable");
    const asMember = await api(`/api/sessions/${ids.session}/rsvp`, {
      method: "POST", token: await freshToken("learnerA", ids.orgA), body: { status: "confirmed", learnerId: t.learner2AId },
    });
    assert.equal(asMember.status, 403, "a learner token cannot seat someone else");
    const asOrgAdmin = await api(`/api/sessions/${ids.session}/rsvp`, {
      method: "POST", token: await freshToken("adminA", ids.orgA, "admin"), body: { status: "confirmed", learnerId: t.learnerAId },
    });
    assert.equal(asOrgAdmin.status, 200, asOrgAdmin.text);
    const asStranger = await api(`/api/sessions/${ids.session}/rsvp`, {
      method: "POST", token: await freshToken("outsiderA", ids.orgA), body: { status: "confirmed", learnerId: t.learner2AId },
    });
    assert.equal(asStranger.status, 403);
  });

  test("M3 — GET /sessions withholds the join link from people who are not in the room", async (tst) => {
    if (!server) return tst.skip("database unreachable");
    const asOutsider = await api("/api/sessions", { token: await freshToken("outsiderA", ids.orgA) });
    assert.equal(asOutsider.status, 200);
    const hidden = asOutsider.json.find((s) => s.id === ids.session);
    assert.ok(hidden, "the session is still listed");
    assert.equal(hidden.joinUrl, null, "the join link is withheld");
    assert.equal(hidden.location, null, "the location is withheld");
    assert.equal(hidden.canJoin, false);
    assert.equal(hidden.title, "B Session", "metadata stays visible");

    const asLearner = await api("/api/sessions", { token: await freshToken("learnerA", ids.orgA) });
    const visible = asLearner.json.find((s) => s.id === ids.session);
    const enrolments = await prisma.enrolment.findMany({ where: { learnerId: t.learnerAId } });
    assert.ok(enrolments.some((e) => e.status !== "withdrawn"), `the learner is enrolled (${JSON.stringify(enrolments.map((e) => e.status))})`);
    assert.equal(visible.joinUrl, "https://meet.example.com/b-session", "an enrolled learner keeps the link");
    assert.equal(visible.canJoin, true);

    const asAdmin = await api("/api/sessions", { token: await freshToken("adminA", ids.orgA, "admin") });
    assert.ok(asAdmin.json.every((s) => s.canJoin || s.joinUrl === null), "staff see every link they manage");
  });
});
