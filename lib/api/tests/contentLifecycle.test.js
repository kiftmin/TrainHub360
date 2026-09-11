import test from "node:test";
import assert from "node:assert/strict";
import { shouldArchive, flagStaleCourses } from "../dist/services/contentLifecycle.js";

test("archives stale course when a newer version exists", () => {
  const r = shouldArchive(
    { id: "c1", version: 1, isArchived: false, lastActiveEnrolmentAt: "2020-01-01", hasNewerVersion: true },
    new Date("2026-09-11"),
  );
  assert.equal(r.archive, true);
});

test("keeps recently active course even with newer version", () => {
  const r = shouldArchive(
    { id: "c2", version: 1, isArchived: false, lastActiveEnrolmentAt: "2026-09-01", hasNewerVersion: true },
    new Date("2026-09-11"),
  );
  assert.equal(r.archive, false);
});

test("never archives without an updated version", () => {
  const r = shouldArchive(
    { id: "c3", version: 2, isArchived: false, lastActiveEnrolmentAt: "2020-01-01", hasNewerVersion: false },
    new Date("2026-09-11"),
  );
  assert.equal(r.archive, false);
});

test("flagStaleCourses returns only archivable ids", () => {
  const out = flagStaleCourses(
    [
      { id: "c1", version: 1, isArchived: false, lastActiveEnrolmentAt: "2020-01-01", hasNewerVersion: true },
      { id: "c2", version: 1, isArchived: false, lastActiveEnrolmentAt: "2026-09-01", hasNewerVersion: true },
    ],
    new Date("2026-09-11"),
  );
  assert.deepEqual(out.map((o) => o.id), ["c1"]);
});
