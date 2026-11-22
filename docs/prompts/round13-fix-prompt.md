# Agent Prompt: Round 13 — Fix the Certificate Race, Lock Down SLAs, and Finish §5.2

**Repo:** `github.com/kiftmin/TrainHub360` (`main` at `9d2bf5a`)
**This prompt is self-contained.** Earlier prompts and reviews were not in the repository last time, so each finding is restated below. **First step:** commit this file to `docs/prompts/round13-fix-prompt.md` in the repo so the scope is always available.
**Scope:** one real concurrency bug, two permission/scale problems, two small hardening items, and the §5.2 items that were specified but not built. Don't change anything else.

---

## 0. Ground Rules

- Phases in order. One PR per phase from current `main`, one commit per numbered step, conventional commits.
- **A step is done only when its tests ran against a real SQL Server and passed.** Put the output in the PR.
- **A failing test is never rerun until it goes green.** If a test fails intermittently, find the root cause and fix it. If you can't, say so in the PR and leave the build red. Add one sentence to the README's CI notes stating this policy.
- Authorization stays database-checked and programme-scoped. Org isolation, requester ≠ approver, the review-credit rules and the audit trail are unchanged.
- Update `lib/api-spec/openapi.yaml` for every route you add or change, add a migration for every schema change (written with SQL Server guards, applied through the documented `prisma:baseline` procedure), and update the README.
- **[CONFIRM] items:** use the stated default, record it in a dated comment, flag it in the PR.
- Write `ROUND13-REPORT.md` at the end: what changed, test totals (API and frontend), what only the real database caught, and anything still open.
- **Before starting:** `pnpm install`, `pnpm run typecheck`, run the full suites, record the baseline.

---

## Phase 1 — Duplicate Certificates (High)

**Problem:** `issueCertificateForEnrolment` looks for an active certificate and, if none exists, creates one. Nothing makes that atomic. The `Certificate` model has no uniqueness on the enrolment, and certificates are issued after the evaluation transaction commits, so two evaluations that finish close together can both pass the check and both create a certificate. The Round 11 parallel-certificate test failed intermittently in CI for exactly this reason and was rerun until green. Recognitions and notifications may duplicate the same way.

### 1.1 Make duplicates impossible in the database
1. Add a migration creating a **filtered unique index** on `certificates(enrolment_id)` where `status = 'active'` and `enrolment_id IS NOT NULL` (name it `UX_certificates_one_active_per_enrolment`).
2. The migration must first clean existing data: for each enrolment with more than one active certificate, keep the earliest, set the others to `revoked`, and write an audit row for each change. Log the counts. Test it on a database seeded with duplicates.
3. In `issueCertificateForEnrolment`, create inside a try/catch. On a unique-index violation (SQL Server errors 2601 and 2627, or Prisma `P2002`), re-read and return the existing active certificate as `existing: true`. Never surface the violation.
4. Keep the existing "no completion source" guard and every other rule unchanged.

### 1.2 Make the other completion side effects idempotent
Inspect everything the evaluation loop emits when an enrolment becomes complete (certificate, recognitions, notifications, emails). List them in the PR. For each one, add a database-level guard so a duplicate can't be written (for example a nullable `dedupeKey` with a filtered unique index on `(userId, dedupeKey)` for notifications, and the equivalent for recognitions), and make the emitting code treat a violation as "already done".

### 1.3 Prove it
- A test calls `issueCertificateForEnrolment` directly, six times in parallel, for 20 fresh enrolments in a loop: exactly one active certificate each.
- A test inserts a second active certificate directly and confirms the database refuses it.
- The existing parallel-evaluation test (4–6 triggers, five rounds) stays and must pass repeatedly: run it 20 times in a loop locally and report the result.
- A migration test with seeded duplicates (see 1.1.2).

---

## Phase 2 — Who Can Set a Thread's SLA (Medium)

**Problem:** `PATCH /threads/:id/sla` is open to any thread participant (plus programme admins and org staff), and `POST /threads` accepts `slaHours` from whoever creates the thread (1–720 hours). A learner can start a thread with a 30-day SLA; a trainer can loosen their own SLA to avoid an escalation. The SLA measures the people who could change it.

1. `PATCH /threads/:id/sla`: only programme admins of the thread's programme and org staff. Participants get 403 (the thread's existence is still not revealed to non-participants; a participant who isn't an admin gets 403, a non-participant 404).
2. `POST /threads`: ignore any `slaHours` in the body unless the caller is a programme admin or org staff. Otherwise use the default (2.3).
3. **Defaults:** add `Organization.defaultSlaHours` (default 24) and nullable `Programme.slaHours`. A new thread uses the programme's value, then the organization's. Org staff can edit the organization default in Settings; programme admins can edit their programme's value on the programme screen. Validate 1–720 on both.
4. In the UI, show the SLA edit control only to programme admins and org staff; everyone else sees the current SLA and the "usually replies within X hours" promise.
5. Audit every SLA change (existing `THREAD_SLA_UPDATED`) and add audit entries for the default changes.

**Tests:** learner and trainer participants get 403 on PATCH; a programme admin of another programme gets 403/404; an admin succeeds and the change is audited; a learner creating a thread with `slaHours: 720` gets the default; an admin creating one can set it; the default resolution order (programme, then organization, then 24) works; UI controls are hidden from learners and trainers.

---

## Phase 3 — Invite Picker That Scales (Medium)

**Problem:** `GET /sessions/:id/invitable` loads the first 500 active users alphabetically and filters them in memory, with no search or paging. In larger organizations most people never appear.

1. Do the filtering **in the query**: learners enrolled (not withdrawn) in the session's course, else programme, else (for a session with neither, org staff only) org users; excluding learners already invited. Order by name.
2. Add `?q=` (case-insensitive match on name or email, minimum 2 characters), `limit` (default 50, max 200) and a stable cursor or offset, and return `total` and `nextCursor`.
3. Replace the client-side "select all enrolled" with a server action (`POST /sessions/:id/invite` with `{ allEnrolled: true }`) that invites every eligible learner in batches and returns the invited and skipped counts, so it works for thousands of people.
4. Update the invite dialog: a debounced search box, "load more", selected-count display, and the existing skip-reason summary.

**Tests:** an organization with 1,200 users: a learner beyond the first 500 is found by search; paging is stable and has no duplicates; withdrawn, already-invited and other-programme learners are excluded; `allEnrolled` invites everyone eligible and reports skips; the response is scoped to the session's organization and programme staff only.

---

## Phase 4 — Two Small Hardening Items (Low)

### 4.1 Removing an attendee must hold
"Remove attendee" currently calls the same code as a decline, so the person stays on the roster as declined and an enrolled learner can confirm again and take the seat back.
1. Add `SessionRSVP.status = "removed"` with `removedBy`, `removedAt` and `removalReason`. The remove route sets it (promoting the next waitlisted learner if the person held a confirmed seat, using the existing race-safe path).
2. `confirmRsvp` refuses a `removed` RSVP (403, "removed from this session by staff"). Only a staff invite clears the state back to `invited`.
3. The roster shows removed people in their own group with the reason.

**Tests:** a removed learner can't confirm again; re-inviting restores the ability to respond; removing a confirmed attendee promotes exactly one waitlisted learner; counts exclude removed people.

### 4.2 Canned-response templates
1. **[CONFIRM]** Default: a template can be edited or deleted only by its author, programme admins of any programme in the organization, and org staff; any programme staff can still read and use them.
2. Limit `body` to 5,000 characters on create and update.

**Tests:** a trainer can't edit or delete another trainer's template; an admin can; the length limit is enforced.

---

## Phase 5 — Items Specified Earlier but Not Built

### 5.1 Deliberate publish choice
- **Backend:** `GET /assessments/:id/publish-impact` (programme staff, org-scoped) for a draft that replaces a live paper, returning `enrolled`, `completed`, `notCompleted` and `withAttempts` counts for the course (withdrawn enrolments excluded).
- **Frontend:** remove the `'minor'` default (`useState<'minor' | 'new_paper'>('minor')`). The publish button stays disabled until the trainer picks one of two described options: *Minor correction* ("Typo, wording or a clarified option. Existing results and attempts carry forward. {withAttempts} learners' results stand.") or *New paper* ("Different questions, correct answers or scoring. {notCompleted} learners who haven't completed must retake it. Learners who have completed keep their status, score and certificate."). The server still returns 400 without `changeKind`.
- **Learner note for a minor change:** "Updated on {date} — minor correction, your result stands."
- **Tests:** the button is disabled until a choice is made; each option shows the real counts; the right `changeKind` is sent; the learner notes appear; `publish-impact` is staff-only, org-scoped and excludes withdrawn enrolments.

### 5.2 Be honest about calendar integration
**[CONFIRM]** Default: `.ics` invitations, per-session `.ics` and the personal feed are the supported calendar approach; Outlook/Google API sync is not built.
- `POST /sessions/:id/sync-calendar` returns 501 with a message pointing to the feed and `.ics` files. Remove the fake sender in `calendarSync.ts` (keep any free/busy reading used by nudges).
- README: a "Calendar" section stating exactly what is supported and what isn't.

### 5.3 Storage honesty
- When `NODE_ENV=production` and `STORAGE_PROVIDER` is unset, log a startup warning that files are on local disk. README "File storage" section: local disk needs a persistent volume and backups; S3/Azure and virus scanning are not built.

### 5.4 Schema verification and production safety
- `pnpm --filter @workspace/db run verify-schema` checks every migration-only object (including the new certificate index, the `EvaluationJob` filtered index, the messaging-depth columns and the `UserRole` key) and exits non-zero naming what's missing.
- At API startup when `NODE_ENV=production`, run the same checks and refuse to start with a clear message if anything is missing.
- CI runs `verify-schema` after the baseline step.
- **Tests:** passes on a correctly migrated database; fails and names the object when one is missing; the startup check refuses in production and is skipped in test.

### 5.5 Learner session cards
Verify that each session the learner is invited to or enrolled for shows: their RSVP status, Confirm and Decline buttons, their waitlist position when waitlisted, a per-session `.ics` link, the join link or location only when the existing visibility rule allows it, and a cancelled session with its reason. Add whatever is missing, with frontend tests.

### 5.6 README
A short "Trainer tools" section: each §5.2 capability, what is supported, and what is explicitly not built (Outlook/Google API sync, cloud storage, virus scanning).

---

## Phase 6 — Generated Clients, Cleanup, Report

1. **Generated clients.** The generator fails on existing OpenAPI validation errors, so clients are stale and can't be rebuilt. Fix the spec errors, regenerate the clients, and add a CI step that runs generation and fails on any generator error or uncommitted diff. Keep the route drift check.
2. **Old branches.** For each remaining remote branch except `main`, confirm its content is already in `main` (`git diff origin/<branch> origin/main` shows only later changes, and `git diff --diff-filter=A --name-only origin/main origin/<branch>` lists no file that exists only on the branch). Create an archive tag (for example `archive/fix-round8`) at its tip, then delete the branch. **[CONFIRM]** Default: tag then delete. Report which were deleted and which were kept and why.
3. **Release tag** once `main` is green (for example `v0.10.0`).
4. Write `ROUND13-REPORT.md`.

---

## Acceptance Criteria

- [ ] A second active certificate for the same enrolment can't be written; existing duplicates are cleaned by the migration; other completion side effects are idempotent; the parallel tests pass 20 times in a row
- [ ] Only programme admins and org staff can set a thread's SLA; learners and trainers can't set it at creation or later; programme and organization defaults exist
- [ ] The invite picker finds any learner in an organization of thousands, with search and paging; "invite all enrolled" works server-side
- [ ] A removed attendee can't confirm again until re-invited
- [ ] Templates can be edited only by their author, admins and org staff
- [ ] The assessment publish dialog has no default and explains both options with real counts
- [ ] Nothing claims Outlook/Google sync; the README states what's supported; the storage warning and README section exist
- [ ] `verify-schema` exists, CI runs it, and production refuses to start with missing migration objects
- [ ] The generated clients build in CI and match the spec
- [ ] Old branches are archived by tag and removed only where their content is in `main`; a release tag exists
- [ ] Full API and frontend suites pass with no skips in CI; `ROUND13-REPORT.md` exists with test totals

---

## Notes for the Agent

- Phase 1 first: a duplicate certificate is a correctness problem a learner or auditor can see.
- If a step conflicts with what the code looks like now, trust the code, adapt, and say so in the PR.
- If you find a related problem that wasn't listed and it's small and in the same area, fix it; otherwise note it in the PR.
- Report honestly: for each step say which tests ran, against which database, and what they showed. A step whose tests could not run is not done.
