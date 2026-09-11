import test from "node:test";
import assert from "node:assert/strict";
import { avgResponseHours, slaStatusFor, findOverdueThreads } from "../dist/jobs/slaJob.js";

const base = (id, slaHours, learnerAt, trainerAt, escalated = false) => ({
  id,
  slaHours,
  lastLearnerMessageAt: learnerAt,
  lastTrainerResponseAt: trainerAt,
  isEscalated: escalated,
});

test("avgResponseHours pairs learner messages with trainer replies", () => {
  const avg = avgResponseHours([
    { author: "learner", createdAt: "2026-09-10T10:00:00Z" },
    { author: "trainer", createdAt: "2026-09-10T22:00:00Z" },
  ]);
  assert.equal(avg, 12);
});

test("avgResponseHours is null with no replies", () => {
  assert.equal(avgResponseHours([{ author: "learner", createdAt: "2026-09-10T10:00:00Z" }]), null);
});

test("findOverdueThreads flags threads past slaHours", () => {
  const now = new Date("2026-09-12T10:00:00Z");
  const out = findOverdueThreads(
    [
      base("t1", 24, "2026-09-10T09:00:00Z", null),
      base("t2", 24, "2026-09-10T09:00:00Z", "2026-09-11T09:00:00Z"),
      base("t3", 72, "2026-09-10T09:00:00Z", null),
    ],
    now,
  );
  assert.deepEqual(out.map((t) => t.id), ["t1"]);
});

test("slaStatusFor reports escalation and pending states", () => {
  assert.match(slaStatusFor(base("t", 24, "2026-09-10T09:00:00Z", null, true), null), /Escalated/);
  assert.match(slaStatusFor(base("t", 24, "2026-09-10T09:00:00Z", null), 12), /12 hours/);
});
