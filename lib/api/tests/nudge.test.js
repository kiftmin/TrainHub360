import test from "node:test";
import assert from "node:assert/strict";
import { parseICalEvents, findFreeSlots } from "../dist/services/nudge.js";

const MOCK_ICAL = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "DTSTART:20260911T090000Z",
  "DTEND:20260911T110000Z",
  "SUMMARY:Standup + planning",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART:20260911T130000Z",
  "DTEND:20260911T170000Z",
  "SUMMARY:Deep work block",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

test("parseICalEvents extracts busy blocks", () => {
  const busy = parseICalEvents(MOCK_ICAL);
  assert.equal(busy.length, 2);
  assert.equal(busy[0].start.toISOString(), "2026-09-11T09:00:00.000Z");
  assert.equal(busy[1].end.toISOString(), "2026-09-11T17:00:00.000Z");
});

test("findFreeSlots recommends the 11:00-13:00 window", () => {
  const day = new Date(2026, 8, 11, 12, 0, 0);
  const slots = findFreeSlots(
    [
      { start: new Date(2026, 8, 11, 9, 0, 0), end: new Date(2026, 8, 11, 11, 0, 0) },
      { start: new Date(2026, 8, 11, 13, 0, 0), end: new Date(2026, 8, 11, 17, 0, 0) },
    ],
    day,
  );
  assert.equal(slots.length, 1);
  assert.equal(slots[0].start.getHours(), 11);
  assert.equal(slots[0].end.getHours(), 13);
});
