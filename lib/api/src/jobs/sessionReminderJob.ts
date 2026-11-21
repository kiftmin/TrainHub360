// Round 8 / D.1: the old 24-hour, off-by-default job is folded into the cadence-aware
// reminder job. This module stays as the job entry point so index.ts and any existing
// import keep working; the behaviour lives in services/reminderCadence.ts.
//
// Differences from the job this replaces:
//   - it follows each organization's cadence instead of one fixed window;
//   - it also sends the unanswered-invitation reminders (the separate runRsvpReminders);
//   - it is scheduled by default (`REMINDER_INTERVAL_MS=0` turns it off).
export { runReminders, scheduleReminderJob } from "../services/reminderCadence.js";

export { runReminders as runSessionReminderJob } from "../services/reminderCadence.js";
