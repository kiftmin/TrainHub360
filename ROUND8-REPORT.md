# Round 8 — gap analysis and completion

The other agent's round-8 work was found uncommitted in `C:/projects/TrainHub360` (68 changed and
untracked paths on top of `6a5e6ab`). This pass verified it against
`trainhub360-round8-fix-prompt.md` and closed what was missing.

## Baseline, measured

- Workspace typecheck clean, API build clean.
- API suite against real SQL Server (`TrainHub360_Test`): **193/193** before any change — the
  138/139 failure the earlier agent reported is gone (the throttle reset in `before()` fixed it).
- Frontend typecheck clean, `test:ui` **40/40**.

## Gaps found and closed

| # | Gap | What was done |
| --- | --- | --- |
| 1 | **No migration for the round-8 schema.** `content_completed_at`, `applied_score_source`, the override/pending columns, `superseded_at`, `thread_participants.left_at/left_reason` and `session_rsvps.waitlisted_at` existed in `schema.prisma` only, so a deployment on `prisma migrate deploy` would run the API against a schema that has no such columns. | Added `lib/db/prisma/migrations/20261122_round8_enrolment_outcome/migration.sql` — GO-split, guarded, additive. Applied with `migrate-baseline.cjs --all`; `prisma migrate status` reports up to date; `migrations.test.js` 4/4. |
| 2 | **1.3 had no UI.** The spec asks for a "new assessment result pending review" flag in the staff enrolment views; nothing in the frontend read `pendingAssessmentScore`, and there was no way to accept or reject a held result. | `useAcceptAssessmentScore` / `useRejectAssessmentScore` hooks, the `Enrolment` type now carries source/override/pending/lock, and a new `components/PendingAssessmentResults.tsx` panel (plus a dialog variant) shown on the programme detail page. Tests in `frontend/src/round8-pending-scores.test.tsx` (4). |
| 3 | **6.2 (CI drift) not wired.** `scripts/check-openapi-drift.mjs` existed but nothing ran it. | Added as a CI step after the schema push. It passes today: *128 operations match*. |
| 4 | **6.1 (env documentation).** `TRUST_PROXY`, `LOGIN_THROTTLE_ALLOW_DISABLE` and `REMINDER_INTERVAL_MS` were read by the code and absent from `.env.example`. | Documented, with what each does when unset. |
| 5 | **6.2 (README).** Nothing described the new behaviour. | Added sections: the assessment lifecycle (versions, grading, completion is not competence), score sources and overrides, locks and sign-off, reminders and calendar, running behind a proxy, email failures, and how to run the suites. |
| 6 | Stray files an operator should not commit. | Removed `artifacts.zip` and the duplicate `.env copy` (the real `.env` is untouched). |

## What the other agent had already covered (verified, not redone)

- **1.1** `services/enrolmentOutcome.ts` — one idempotent `evaluateEnrolment`, wired from content
  progress/verification, item add/archive, attempt graded, assessment publish/supersede and manual
  status; `applyAttemptOutcome` now delegates to it.
- **1.2** lock and sign-off rules with the audit entry and notifications; owner-only override.
- **1.3** reason-of-10 rule, `appliedScoreSource`, pending result, accept/reject routes, and the
  standing score computed as the average of live applied results.
- **2.x** the builder, learner attempt and grading screens against the real contract (`Grading.tsx`,
  the rewritten `Assessments.tsx`, `round8-assessment-ui.test.tsx`), grading-queue and graded
  notifications, in-flight attempts across a version bump.
- **3.1–3.3** `tests/support/resetTestState.js` in every file that logs in, `--test-concurrency=1`,
  `config/proxy.ts` + `TRUST_PROXY`, `/email-failures` with the Settings section.
- **4.1–4.2** `services/reminderCadence.ts`, `services/ical.ts`, `/sessions/:id/ics`, session
  PATCH/cancel with `SEQUENCE`, `/reminders/run`.
- **5.1–5.11** progress state machine, verification queue + `Verification.tsx`, withdrawn learners,
  bulk-remove UI, `ThreadParticipant.leftAt`, bookings by id, `waitlistedAt`, capacity validation,
  upload signature check, provider suffix match, the small fixes (ambiguous `PATCH`, first message
  author name, no duplicate `adminProgrammeIds`, no `PUBLIC_PATHS`, session date/time in the
  session's timezone), and the recorded session-visibility decision.

## Verification after the changes

- `prisma migrate status`: 3 migrations, database up to date.
- API suite: **193/193** (`pnpm --filter @workspace/api run test`, real SQL Server).
- Frontend: typecheck clean, `test:ui` **44/44**.
- `node scripts/check-openapi-drift.mjs`: none, 128 operations match.

## Still open (not in round 8's scope, recorded so nothing is lost)

- Storage providers beyond local disk (S3/Azure) and a real `scanUpload`; real Outlook/Google
  calendar sync (documented as not built).
- The work is still stacked on `fix/a2-email-notifications` (PR #2). Splitting it into the ordered
  PRs the prompt asks for (A.1 → A.2 → A.3 → Phase B → Phase 4 → round 8) is a repository step, not
  a code one.
