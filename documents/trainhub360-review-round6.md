# TrainHub360 — Review of the Applied Fixes (commits `e8a03a6`, `ded8dda`)

**Scope:** the five phases of `trainhub360-fixes-and-trainer-tools-prompt.md` (user-management fixes, direct messaging, course builder, assessment builder, scheduling/RSVP/notifications).
**Method and limits:** static read of the code. I can't run Prisma or the tests in my sandbox, so nothing here is test-verified. Express behaviour in finding H1 is from known Express 4 semantics, not from running your server. Please confirm H1–H4 by running them.
**Not checked in this pass:** `GET /users` field restriction (item 1.7), the `UserRole` migration script, the login rate limiter's internals, and whether every leftover `requireRole(` use is intentional.

---

## 1. Summary

A lot of this is done well, and several items are done better than the prompt asked for. The biggest remaining problems are:

- Account activation can't work with the default configuration (H2).
- File uploads are capped by the body parser at roughly 75 KB (H4).
- Passing an assessment doesn't feed competence, certificates or review credit (H5).
- Errors thrown in route handlers may leave requests hanging (H1).

---

## 2. Verified as correctly implemented

**Phase 1 (user management)**
- `POST /programmes/:id/members` now only adds grants, inside a transaction. A person can hold several roles in one programme. `PATCH` and `DELETE` operate on specific roles. `assertNotLastProgrammeAdmin` is shared across the routes and also guards bulk removal.
- Owners are protected: only an owner can change or deactivate an owner, the last owner can't be removed or deactivated, and self-deactivation and self-lockout are blocked by the API.
- Provisioned accounts get a random unguessable password hash plus a single-use activation token (7 days). `tokenVersion` is in the JWT and checked on every request, so role changes, deactivation and password changes take effect immediately. The auth middleware now fails closed (503 on a database error, 401 for a missing or inactive user).
- Removing a member withdraws their enrolments instead of deleting them. Removing 5 or more people at once (`bulkRemovalThreshold`) goes through a delete request.
- Session create, invite and calendar-sync are programme-scoped through `canManageSessionProgramme`.

**Phase 2 (messaging)**
- `POST /threads` exists, with a participant model. Learners can only start threads with trainers or admins of their own programme.
- Visibility is limited to participants and programme admins. Org staff see thread metadata and SLA status only. Non-participants get 404, and stakeholders are blocked. The author comes from the token. Only a trainer participant's reply clears escalation.

**Phase 3 (course builder)**
- One `ContentItem` model covers native content, files and external links, with `ContentProgress` for all three. Links must be `https`. Downloads are authenticated, org-scoped and sent with `nosniff` and `attachment`. Content is archive-only. Progress is computed from required items.

**Phase 4 (assessments)**
- The stub attempts endpoint now returns 410. Grading happens on the server and the answer key is never sent to learners. Questions are locked once an assessment is published.

**Phase 5 (scheduling)**
- Online sessions require an `https` `joinUrl` and offline sessions require a `location`. There is a double-booking warning, a `notify()` service, a personal ICS feed, and waitlist promotion now sends a notification.

---

## 3. Findings

### High

**H1. Thrown errors in route handlers probably leave the request hanging.**
The API uses Express 4.21 with no `express-async-errors`. Express 4 doesn't forward rejected promises from `async` handlers to the error middleware. Many handlers do `await assertProgrammeInOrg(...)` or `await assertNotLastProgrammeAdmin(...)` outside a try/catch, and these helpers throw errors carrying `.status` (404/409). In Express 4 that becomes an unhandled rejection. `index.ts` just logs it and keeps the server up, so the client never gets a response. One example is `PATCH /programmes/:id/members/:userId` with a `roles` array: the last-admin 409 isn't caught there. Cross-org requests are still blocked, but they would hang instead of returning 404.
I missed this pattern in earlier rounds too. Fix: add `express-async-errors` (or upgrade to Express 5), and add a test that asserts the 404/409 responses actually arrive.

**H2. New users and password resets can't work with the default setup.**
The default `consoleEmailSender` logs only the recipient and subject, not the body. The earlier `console.log` of the reset token was removed. So activation links and reset links are never visible anywhere. The frontend also has no `/activate` page (no route in `App.tsx` or `Login.tsx`). Until an email provider is configured and an activation page exists, a newly created or imported user cannot get in. Fix: a real email provider, an activation page, and a dev-mode sender that logs the link.

**H3. Trainer matching by name is still there, and one rename can write across organizations.**
- `PATCH /users/:id` (rename) runs `course.updateMany({ where: { OR: [{ trainerId }, { trainer: oldName }] } })` with no organization or programme filter. Renaming a user in one org rewrites the trainer display name on courses in other orgs that share the old name.
- Member removal, role change and bulk removal still unassign courses with `OR: [{ trainerId }, { trainer: name }]`. Two trainers with the same name in a programme will affect each other's courses. The name fallback should only apply where `trainerId` is null.

**H4. File uploads can't exceed roughly 75 KB.**
Uploads send the file as base64 inside a JSON body, but `index.ts` uses `express.json()` with the default 100 KB limit. Almost any real PDF or video is rejected with 413 before it reaches the route, so the 50 MB limit is unreachable. Fix: use `multer` (or streaming) for the upload route, or raise the limit on that route.

**H5. Assessments don't feed competence, certificates or review credit, and "applied" isn't really scenario-based.**
- Passing an assessment doesn't set `Enrolment.appliedAssessmentScore`, mark competence, issue a certificate, trigger recognitions or recompute the review-credit score. `computeCompetence` is read-only and only affects the response. Those values change only when staff type a score in (`PATCH /enrolments/:id`).
- The only question type is multiple choice (an "applied" question is a multi-select). There is no scenario or short-answer type, and the `scenarioContext` and `rubric` fields aren't used. There is no manual grading route, no `GET /attempts/:id` and no save-answers route. The rule that applied assessments must include a scenario or short-answer question isn't enforced.
- The time limit is returned at start but never checked on submit.
- `maxAttempts` can be bypassed. It's checked only when an attempt starts and only counts submitted attempts, so a learner can start many attempts first and then submit them all.

### Medium

| # | Issue |
|---|---|
| M1 | **Removed members keep thread access.** Thread access depends on a `ThreadParticipant` row, which isn't revoked when someone loses their programme grant or is withdrawn. |
| M2 | **RSVP problems.** (a) A confirmed learner who re-confirms when the session is full is moved to the waitlist (their own seat counts against them). (b) The capacity check isn't atomic, so concurrent confirmations can exceed capacity. (c) There is no eligibility check, so any user in the org can RSVP into any session. (d) Any non-learner token role can RSVP or decline on behalf of any `learnerId` in the request body, which can also trigger waitlist promotion. |
| M3 | **`GET /sessions` returns every session in the org to everyone, including `joinUrl` and location**, regardless of programme or invitation. |
| M4 | **Reminder cadence isn't implemented.** `reminderCadenceJson` exists in the schema but nothing reads it. `runRsvpReminders` is never called by any job or route (and sends one reminder only). `scheduleSessionReminderJob` does nothing unless `SESSION_REMINDER_INTERVAL_MS` is set, and sends one reminder per attendee. There is no manual run route. Invitations don't carry an `.ics` attachment and there is no `GET /sessions/:id/ics` (the personal feed does exist). |
| M5 | **Content progress integrity.** A learner can reset a trainer-verified item back to `in_progress` (the upsert overwrites status). `storageKey` on content creation and `evidenceFileKey` on progress are accepted from the request body without checking they came from an upload in this org. There is no trainer UI for verifying external-link evidence (`useVerifyContent` isn't used by any page). |
| M6 | **Test coverage.** The new database-backed tests still return early when `DATABASE_URL` is unset, which the prompt said not to do. I found no tests for thread visibility, last-admin/last-owner guards, `tokenVersion`, programme-scoped session permissions, or RSVP capacity. The new unit tests are four pure-function checks (URL, provider, storage key, ICS). |

### Low
- `providerForUrl` uses `endsWith("coursera.org")`, so `evilcoursera.org` is labelled Coursera.
- Session `capacity` is unvalidated. Date and time strings are derived in UTC while a separate timezone is stored.
- `PATCH /assessments/:id` appears to allow changing `type` and `passMark` after publishing (worth confirming).
- `PATCH members` with `toRole` and no `fromRole` changes an arbitrary grant when the user holds several.
- `GET /courses/:id/content` and the progress route don't exclude withdrawn enrolments (download does).
- `POST /bookings` still matches the trainer and course by name and doesn't check the learner is enrolled under that trainer.
- The first thread message stores the token role as the author name. `PUBLIC_PATHS` in `auth.ts` is unused.
- Frontend: no notification bell or list, no activation page, and no UI for bulk removal or content verification.

---

## 4. Phase scorecard

| Phase | Result |
|---|---|
| 1. User management | Mostly done. Open: H1, H2, H3. Not checked: 1.7 |
| 2. Direct messaging | Done, with M1 |
| 3. Course builder | Backend done. Open: H4, M5 |
| 4. Assessment builder | Partial. Open: H5 |
| 5. Scheduling, RSVP, notifications | Partial. Open: M2, M3, M4, email provider |

## 5. Suggested order for the next pass
1. H1 (async errors), H2 (activation page and a usable email path), H4 (upload limit).
2. H3 (remove the name fallback, scope the rename).
3. H5 (wire passing an assessment into the enrolment, certificate and review credit; add scenario questions and manual grading; fix time limit and attempts).
4. M2, M3, M1.
5. M4 (reminder cadence, run route, `.ics`), M5, M6, then the low items.
