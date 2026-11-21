# Phase B — trainer identity, thread access, RSVP and session visibility

Closes **H3**, **M1**, **M2** and **M3** from `trainhub360-review-round6.md`. These are the four
findings the round-6 review grouped under "suggested order" step 2 and step 4.

## H3 — trainer matching by name, and a rename that wrote across organizations

**What was wrong**

- `PATCH /users/:id` renamed a user and then ran
  `course.updateMany({ where: { OR: [{ trainerId }, { trainer: oldName }] } })` with **no
  organization filter**. Renaming "Same Name" in one tenant rewrote the trainer display name on
  every course in every organization that had a trainer with that name.
- Member removal, role change and bulk removal unassigned courses with the same
  `OR: [{ trainerId }, { trainer: name }]` shape, so two trainers with the same name in one
  programme affected each other's courses.

**What changed** — six call sites (`routes/index.ts` lines 255, 676, 766, 802, 819, 853):

- The rename is scoped to `programme: { orgId: scope.orgId }`, so it can only touch this
  organization's courses.
- The name fallback now reads `{ trainerId: null, trainer: name }` — it applies **only** to
  legacy rows with no identity, never to a course that belongs to a different trainer who
  happens to share the name.

**Tests** (`phase-b.test.js`): a rename in org A leaves org B's course untouched; removing a
trainer's grant clears only the `trainerId: null` legacy row and leaves another trainer's
same-named course alone.

## M1 — removed members kept thread access

**What was wrong** — access to a thread was a `ThreadParticipant` row, and nothing ever deleted
it. Losing the programme grant, or being withdrawn from the programme, left the row in place, so
the person could still read and post.

**What changed**

- New `revokeStaleThreadAccess(userId, orgId)` (`routes/index.ts`). It deletes the caller's
  participant rows for threads whose programme they no longer belong to, and writes a
  `THREAD_ACCESS_REVOKED` audit entry.
  - Staff grants (`admin`/`trainer`/`owner`) keep access.
  - A **learner** grant alone is not enough: withdrawal keeps the grant, so the enrolment
    decides. This was found by a failing test — the first version of the fix left the row in
    place because the grant survived the withdrawal.
  - Org staff are never revoked: they administer every programme.
- It runs on every thread read and write (`GET /threads`, `GET /threads/:id/messages`,
  `POST /threads/:id/messages`), on programme member removal (single, per-role and bulk), and on
  a withdrawal through `PATCH /enrolments/:id`.
- `isProgrammeAdmin` now also returns true for org-wide owner/admin, matching the rule
  `requireProgrammeRole` already used. Before this, an org admin saw *metadata only* for their own
  programmes' threads while being allowed to manage those programmes everywhere else.

**Tests**: a removed member gets `404` on the thread and it disappears from their list, and the
participant row is deleted; an org admin still reads it. A withdrawn learner loses the thread.

## M2 — RSVP

| | What was wrong | What changed |
| --- | --- | --- |
| (a) | A confirmed learner who re-confirmed when the session was full was moved to the **waitlist** — their own seat counted against them. | `confirmRsvp` returns the existing row unchanged when it is already `confirmed`. Only a decline frees the seat. |
| (b) | The capacity check was read-then-write, so two confirmations at once could exceed capacity. | The count and the write run in one transaction under `SELECT … WITH (UPDLOCK, HOLDLOCK)` on the session row — a **database** lock, so it holds across API instances. Promotion from the waitlist takes the same lock. |
| (c) | Any user in the org could RSVP into any session. | New `assertRsvpEligible`: the learner must have an RSVP row (an invitation) or a live enrolment on the session's course. Otherwise `403 "you are not invited to this session"`. A cancelled or completed session is a `409`. |
| (d) | Any non-learner token could RSVP or decline for **any** `learnerId` in the body — and so trigger waitlist promotion. | A token answers only for itself unless it is org staff or staff of the session's programme; the target must be a learner (or enrolled) in the same organization. |

**Tests**: re-confirming keeps the seat while a second learner is waitlisted; six learners
confirming at once against `capacity: 2` leave exactly 2 confirmed, in the responses *and* in the
database; a learner with no invitation or enrolment gets `403`; a learner token cannot seat
another learner, an org admin can, an outsider cannot.

## M3 — every session, join link included, went to everyone

**What was wrong** — `GET /sessions` returned every session in the organization to every user,
with `joinUrl` and `location` included. A join link is the right to be in the room.

**What changed** — the list is still returned (people need to see what is scheduled), but
`joinUrl`/`location` are only sent to someone who could attend: org staff, programme staff of the
session's programme, the session's trainer, an invited learner (an RSVP row), or a learner
enrolled on the session's course. Everyone else gets `joinUrl: null`, `location: null` and
`canJoin: false`.

**Test**: an outsider sees the session with no link; an enrolled learner keeps it; staff see the
links they manage.

## Also fixed on the way

`PATCH /enrolments/:id` read `current.status` **after** the update, so the "was this a withdrawal"
check could never be true. It is now captured before the update. This is what made the M1
withdrawal hook silently do nothing on the first attempt.

`a2-gaps.test.js` restored the login throttle limits in a `finally` **without clearing the
buckets**, so the failures it recorded leaked into `auth.test.js` — which is how it surfaced as
"correct password succeeds → 401" in this run. It now calls `resetLoginThrottleConfig()`.

## Results

| Check | Before | After |
| --- | --- | --- |
| API suite (real SQL Server) | 126 pass | **135 pass / 0 fail / 0 skipped** |
| Frontend suite | 33 pass | **33 pass / 0 fail** (5 files) |
| `pnpm --filter @workspace/api run build` | clean | clean |
| `frontend` `pnpm run typecheck` | clean | clean |

## Still not started

- **Phase C:** the assessment → competence → certificate → review-credit loop, scenario and
  short-answer questions, manual grading, the time limit and the `maxAttempts` bypass.
- **Phase D:** reminder cadence (`reminderCadenceJson` is still unread), a manual reminder run
  route, `.ics` attachments on invitations.
- **Phase E:** content integrity and the verification UI.
- Remaining low items from round 6 (`providerForUrl` suffix match, session `capacity`
  validation, UTC date/time strings, `PATCH /assessments/:id` after publishing, `POST /bookings`
  matching by name, the unused `PUBLIC_PATHS`).

## Files touched

`lib/api/src/routes/index.ts` (H3 ×6, M1 hook + `revokeStaleThreadAccess`, M2(d) route, M3
`GET /sessions`, enrolment withdrawal fix), `lib/api/src/services/rsvp.ts` (M2 a–c),
`lib/api/src/middleware/rbac.ts` (`isProgrammeAdmin`), `lib/api/tests/phase-b.test.js` (new, 9
cases), `lib/api/tests/a2-gaps.test.js` (throttle leak), `lib/api/package.json` (test list).
