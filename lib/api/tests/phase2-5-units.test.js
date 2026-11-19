import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { providerForUrl, isSafeExternalUrl } from "../dist/services/contentProgress.js";
import { buildIcsCalendar } from "../dist/services/ical.js";
import { newStorageKey } from "../dist/services/storage.js";

describe("phase 2-5 helpers", () => {
  test("providerForUrl classifies common learning links", () => {
    assert.equal(providerForUrl("https://www.coursera.org/learn/x"), "coursera");
    assert.equal(providerForUrl("https://www.udemy.com/course/x"), "udemy");
    assert.equal(providerForUrl("https://www.linkedin.com/learning/x"), "linkedin_learning");
    assert.equal(providerForUrl("https://example.com/lesson"), "other");
    assert.equal(providerForUrl("/api/content/abc/download"), "other");
  });

  test("isSafeExternalUrl only accepts https URLs", () => {
    assert.equal(isSafeExternalUrl("https://example.com"), true);
    assert.equal(isSafeExternalUrl("http://example.com"), false);
    assert.equal(isSafeExternalUrl("javascript:alert(1)"), false);
    assert.equal(isSafeExternalUrl("file:///etc/passwd"), false);
    assert.equal(isSafeExternalUrl("not a url"), false);
  });

  test("newStorageKey uses the extension and resists traversal", () => {
    const key = newStorageKey(".pdf");
    assert.match(key, /^[\w/-]+\.pdf$/);
    assert.ok(!key.includes(".."));
    assert.ok(!newStorageKey("../../x").includes(".."));
  });

  test("buildIcsCalendar escapes names and emits an event per session", () => {
    const ics = buildIcsCalendar({
      name: "Team, Calendar; Demo",
      now: new Date("2026-01-01T00:00:00Z"),
      sessions: [
        {
          id: "s1",
          title: "Safety, part 1; intro",
          date: "2026-02-03",
          time: "09:00",
          startsAt: new Date("2026-02-03T09:00:00Z"),
          endsAt: new Date("2026-02-03T10:00:00Z"),
          timezone: "UTC",
          location: "Room 1",
          joinUrl: null,
          trainer: "Sam",
        },
      ],
    });
    assert.match(ics, /^BEGIN:VCALENDAR/);
    assert.ok(ics.includes("BEGIN:VEVENT"));
    assert.ok(ics.includes("UID:s1@trainhub360"));
    assert.ok(ics.includes("SUMMARY:Safety\\, part 1\\; intro"));
    assert.ok(ics.trim().endsWith("END:VCALENDAR"));
  });
});
