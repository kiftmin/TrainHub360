# Agent Prompt: Bring TrainHub360 Into Full Alignment With Proposal v1.2

**Repo:** `github.com/kiftmin/TrainHub360`
**Source of truth for gaps:** `trainhub360-gap-analysis.md` (companion document — read it first, it explains *why* each item below matters and cites the exact current code)
**Source of truth for requirements:** `documents/corporate-training-platform-proposal v1.2`

---

## 0. Ground Rules

- **Work in phases, in the order given below.** Phase 1 is security-critical and must land before anything else — don't get pulled into Phase 3/4 feature work while Phase 1 is incomplete.
- **Commit after every numbered step**, not just every phase. Use conventional commits: `fix(auth): verify password hash on login`, `feat(rbac): scope programme roles`, etc.
- **Every step includes a verification action.** Do not mark a step done until its verification passes.
- **Don't break what already works.** `reviewCredit.ts`, `slaJob.ts`, `nudge.ts`, `aiExplainer.ts`, and their tests are solid — extend them, don't rewrite them, unless a step below explicitly says to change their logic.
- **Preserve existing test files** under `lib/api/tests/` and add new ones alongside them using the same `node --test` style already in use (see `lib/api/package.json`'s `test` script — add new test files to that script's list as you create them).
- **Stack facts to respect:** Prisma + SQL Server (`lib/db/prisma/schema.prisma`), Express 4 (`lib/api`), React 19 + Vite + TanStack Query + wouter (`frontend`), pnpm workspaces (root `pnpm-workspace.yaml`). Do not introduce a different ORM, router, or package manager.
- **Run before you start:** `pnpm install`, `pnpm run typecheck`, `pnpm --filter @workspace/api run test` — confirm a clean baseline before your first change.

---

## Phase 1 — Critical Security Fixes (blocking; do not skip or reorder)

### 1.1 Verify passwords on login

**Problem:** `POST /auth/login` in `lib/api/src/routes/index.ts` looks up a user by email and issues a JWT with no password check at all.

**Steps:**
1. Add `bcrypt` (or `argon2`, but stay consistent with whichever you pick) as a dependency of `@workspace/api`.
2. Add a `POST /auth/register` or reuse the seed path to ensure `User.passwordHash` is actually populated with a real hash (currently seeded as `""`). At minimum, add a helper `hashPassword(plain: string): Promise<string>` and `verifyPassword(plain: string, hash: string): Promise<boolean>` in a new `lib/api/src/services/password.ts`.
3. Update `POST /auth/login` to require `password` in the request body, reject with `400` if missing, look up the user, and call `verifyPassword`. Return `401 { error: "invalid credentials" }` if the user doesn't exist OR the password doesn't match — **use the same error message and take a similar code path for both cases** so the endpoint doesn't leak which emails exist (timing-safe-ish; don't early-return before hashing when the user is missing — compare against a dummy hash instead).
4. Update `prisma/seed.ts` to hash a real seed password (e.g. from `SEED_ADMIN_PASSWORD` env var, default only for local dev) instead of leaving `passwordHash: ""`.
5. Update `frontend/src/pages/Login.tsx` to send a `password` field.

**Verify:** New test `lib/api/tests/auth.test.js` — assert login with correct password succeeds, login with wrong password returns 401, login with unknown email returns 401 (not 404), and the two failure responses are indistinguishable in shape. Add the new test file to the `test` script in `lib/api/package.json`.

### 1.2 Enforce organization-level data isolation on every core query

**Problem:** `GET /programmes`, `GET /courses`, `GET /enrolments`, `GET /programmes/:id/modules`, `GET /modules/:id/assessments`, and others query with no `orgId` filter — any authenticated user can see every organization's data.

**Steps:**
1. Add a small helper in `lib/api/src/db.ts` (or a new `lib/api/src/lib/scope.ts`): `orgScope(req: AuthedRequest)` that returns `{ where: { orgId: req.user!.orgId } }` (throw/401 if `req.user.orgId` is missing).
2. Go through every route in `routes/index.ts` that reads or writes `Programme`, `Course`, `Module`, `Assessment`, `Enrolment`, `MessageThread`, `Booking`, `CalendarEvent`, `Session` and add the `orgId` filter. For nested resources without a direct `orgId` column (e.g. `Module`, `Assessment`), filter through the relation (e.g. `where: { course: { programme: { orgId } } }`), matching the pattern already used in `lifecycleFilter()`.
3. Pay special attention to write paths: `POST /courses`, `POST /programmes/:id/modules`, `POST /modules/:id/assessments`, `POST /enrolments` — these must verify the target `programmeId`/`courseId`/`moduleId` actually belongs to the requester's org **before** creating the child record, not just filter reads.
4. Since the schema doesn't have `orgId` directly on `Module`/`Assessment`/`Enrolment`, decide whether to (a) add a denormalized `orgId` column to each for cheap filtering (recommended — add a Prisma migration), or (b) always filter through the relation chain. If you choose (a), backfill existing rows in the migration.

**Verify:** New test `lib/api/tests/tenant-isolation.test.js` — seed two organizations with one programme/course each, authenticate as a user in org A, and assert `GET /programmes`, `GET /courses`, and `GET /enrolments` return zero rows belonging to org B. Also assert `POST /programmes/:idInOrgB/modules` as an org-A user returns `403` or `404`, not `201`.

### 1.3 Enforce RBAC on every mutation route, and scope it per-programme

**Problem:** `requireRole()` exists and works but is applied to roughly 8 of ~35 routes. Critically, `PATCH /enrolments/:id` has no role check at all, so a learner can set their own `managerSignOff` and `appliedAssessmentScore`. Also, `UserRole.programmeId` exists in the schema but is never checked — a Programme Administrator on Programme A has no barrier to editing Programme B.

**Steps:**
1. Extend `lib/api/src/middleware/rbac.ts` with a new `requireProgrammeRole(...roles: string[])` that:
   - Confirms `req.user` exists and has one of the given roles **for the specific `programmeId` in the request** (read from `req.params.programmeId`, `req.body.programmeId`, or resolved via the target entity — e.g. for `/courses/:id`, look up the course's `programmeId` first).
   - Falls back to allowing org-level `owner`/`admin` roles to bypass the per-programme check (org owners should still be able to act across programmes, per §4's "single person can hold more than one role" language) — but make this an explicit, named allowance in the code, not an accidental gap.
2. Apply role checks to every mutation route currently missing one. At minimum:
   - `POST /courses` → `requireProgrammeRole("admin", "owner")` (Programme Administrator only, per §4)
   - `POST /programmes/:id/modules`, `POST /modules/:id/assessments` → same
   - `POST /enrolments` → `requireProgrammeRole("admin", "owner", "trainer")`
   - `PATCH /enrolments/:id` → split into two concerns:
     - Anyone enrolled can update their own `status` (e.g. mark a module viewed) — allow this for the learner themselves.
     - `appliedAssessmentScore` can only be set by a `trainer` or `admin`/`owner` role scoped to that programme.
     - `managerSignOff` can only be set by a user who is the enrolled learner's **line manager** — this requires a `managerId` field on `User` (add via migration if it doesn't exist) and a check that `req.user.id === learner.managerId`, not just any trainer/admin.
   - `POST /bookings`, `POST /sessions` (if a create route exists/gets added) → require the requester to be the trainer or an enrolled learner for that programme.
3. Write a short internal doc comment above `requireProgrammeRole` explaining the org-owner bypass so a future reader doesn't mistake it for a bug.

**Verify:** Extend `lib/api/tests/phases.test.js` (or add a new `rbac.test.js`) with cases: learner cannot create a course (403), learner cannot set their own `managerSignOff` (403), the learner's actual manager can set it (200), a Programme Administrator on Programme A gets 403 when hitting Programme B's course-create route, and org `owner` role succeeds across programmes.

### 1.4 Real SSO/SAML validation (or explicitly gate the stub)

**Problem:** `POST /auth/sso` accepts any truthy `samlAssertion` and returns a token for a hardcoded `sso-user`.

**Steps (pick one):**
- **Option A (recommended for real enterprise pilots):** integrate a vetted SAML library (e.g. `@node-saml/node-saml` or `samlify`) to actually validate the assertion signature, issuer, and audience against configured IdP metadata per organization (`Organization` needs a new `samlMetadataUrl`/`samlCertificate` field).
- **Option B (if SSO isn't needed for the next pilot):** leave the endpoint disabled behind a feature flag (`SSO_ENABLED=false` by default) and return `501 Not Implemented` when disabled, so it can't silently masquerade as a working integration in a demo to a security-conscious buyer.

**Verify:** If Option A — a test asserting a tampered/unsigned assertion is rejected with 401. If Option B — a test asserting the endpoint returns 501 when the flag is off.

---

## Phase 2 — Role & Governance Completeness

### 2.1 Add the missing Stakeholder role end-to-end

**Steps:**
1. `prisma/seed.ts` — add `stakeholder` to the roles loop alongside `owner`, `admin`, `trainer`, `learner`.
2. Decide the read-only scope: a `Stakeholder`'s `UserRole.programmeId` (or a new department-scope field, if departments get modeled in 3.3) determines what they can see.
3. Add `requireRole`/`requireProgrammeRole` checks so `stakeholder` can hit `GET` routes for programmes/courses/KPIs within their scope but gets `403` on every `POST`/`PATCH`/`DELETE` in the system, with no exceptions.
4. Frontend: add a `StakeholderDashboard` page (new file under `frontend/src/pages/`) — read-only cards for programme progress, KPI summary, and coverage, scoped to the programmes the stakeholder's `UserRole` rows grant. Add a nav-guard so `stakeholder` users only see this page (hide the rest of `nav`/`adminNav` for that role in `App.tsx`'s `Shell`).

**Verify:** Test that a stakeholder role gets `200` on `GET /programmes` (scoped) and `403` on `POST /courses`, `PATCH /enrolments/:id`, etc.

### 2.2 Wire up content lifecycle automation

**Problem:** `services/contentLifecycle.ts`'s `shouldArchive`/`flagStaleCourses` are correct and unit-tested but never called outside the test file.

**Steps:**
1. Add `lib/api/src/jobs/contentLifecycleJob.ts` following the exact pattern of `jobs/kpiJob.ts`/`jobs/nudgeJob.ts`: fetch courses (with their newest-version sibling and last-active-enrolment date computed from `Enrolment.completionDate`/`status`), call `flagStaleCourses`, and for each flagged course call `db.course.update({ data: { isArchived: true, archivedAt: new Date() } })` plus an audit log entry (mirror the pattern in the existing `POST /courses/:id/archive` route).
2. Add a scheduling hook analogous to `scheduleKpiJob()` (e.g. `scheduleContentLifecycleJob()`), gated by an env var like `CONTENT_LIFECYCLE_INTERVAL_MS`, and call it from wherever `scheduleKpiJob()` is currently invoked at startup (check `lib/api/src/index.ts`).
3. Add an admin-triggerable route `POST /content-lifecycle/run` (role-gated `admin`/`owner`) that runs it on demand, mirroring `POST /nudge/run` and `POST /sla/run`.

**Verify:** New test asserting that after seeding a stale course with a newer version and no recent enrolments, running the job results in `isArchived: true` and an audit log entry.

### 2.3 Encode the "Organization Owner is separated from training content" policy

**Problem:** v1.2's §4 redefined Organization Owner as an IT/SysAdmin role "strictly separated from training content," but the code treats `owner` as just another role string with the same permissions surface as `admin`.

**Steps:**
1. Decide the actual policy: should `owner` be **blocked** from creating/editing courses (not just permitted to bypass programme scoping), to genuinely enforce the "separation" language? Confirm this interpretation before implementing — if confirmed, `requireProgrammeRole` for content-mutation routes should explicitly exclude `owner` (only `admin` and `trainer` can touch course content; `owner` can manage org settings, SSO, billing, and view KPI rollups, per §4).
2. Update the RBAC checks from 1.3 accordingly once confirmed.

**Verify:** Test that `owner` role gets `403` on `POST /courses` (if the policy is confirmed as a hard block) while still getting `200` on `PATCH /organizations/:id` (settings) and `GET /organizations/:id/review-credits`.

---

## Phase 3 — Missing Core Features (feature-complete against the proposal)

### 3.1 Self-service organization registration with domain verification

**Steps:**
1. Add `POST /organizations` (public, no auth required) accepting `{ name, adminEmail, adminName, domain }`. Create the `Organization`, the first `User` (role `owner`), and send a verification email/token (stub the email send behind an interface if no email provider is configured yet — log to console in dev, matching the existing pattern in `services/nudge.ts`'s `sendNudges`).
2. Add a `domainVerified: Boolean @default(false)` field to `Organization`, plus a `domainVerificationToken` field. Add `POST /organizations/:id/verify-domain` to confirm.
3. Gate certain org-level actions (e.g. enabling SSO, enabling the Review Credit module) behind `domainVerified: true` if that matches the business intent — confirm with the business before hard-gating, otherwise just surface the status in the frontend.
4. Frontend: add a `Register.tsx` page and route it from `Login.tsx` ("Create an organization" link).

**Verify:** Test the full flow — register, org exists with `domainVerified: false`, verify with a valid token flips it to `true`, verify with an invalid token returns `400`.

### 3.2 Bulk learner import (CSV / HRIS sync) with role auto-mapping

**Steps:**
1. Add `POST /organizations/:id/learners/import` (role-gated `admin`/`owner`) accepting a CSV file (use `multer` or similar for the upload) or a JSON array of `{ name, email, department, jobFunction, managerEmail }` rows.
2. Parse rows, upsert `User` records scoped to the org, auto-map `role` based on a configurable mapping table (e.g. a `jobFunction` → `Role` lookup the Programme Administrator configures once), and resolve `managerEmail` to the new `managerId` field from 1.3.
3. Return a per-row result summary (`{ created, updated, failed, errors: [...] }`) rather than an all-or-nothing response, so partial success is visible.
4. Frontend: add an import UI on the `People.tsx` page (or wherever bulk actions belong) — file picker, upload, and a results table.

**Verify:** Test importing a CSV with one valid row, one row with a bad email, and one row referencing an unknown manager — assert the response reports 1 created, 1 failed (with a clear error), and 1 partial (created but with `managerId: null` and a warning, not a hard failure).

### 3.3 Cohort / department model for grouping and coverage reporting

**Steps:**
1. Add a `Cohort` model to `schema.prisma`: `id`, `orgId`, `name`, `department` (or a separate `Department` model if departments need their own attributes), with a many-to-many or one-to-many relation to `User` (decide based on whether a learner can be in multiple cohorts — likely yes, so many-to-many via a join table `CohortMember`).
2. Add `POST /cohorts`, `GET /cohorts`, `POST /cohorts/:id/members` (role-gated to Programme Administrator/Owner).
3. Extend enrolment creation to optionally target a whole cohort (`POST /cohorts/:id/enrol` with a `courseId`) rather than one learner at a time.
4. Update the KPI job (`jobs/kpiJob.ts`) to compute "coverage by department/cohort" — group enrolments by cohort and report completion/competency rate per cohort, matching §8/§9's "coverage by department/cohort" KPI.

**Verify:** Test that enrolling a cohort of 3 learners in a course creates 3 `Enrolment` rows, and that the KPI payload includes a per-cohort breakdown.

### 3.4 Certificate / compliance expiry tracking

**Steps:**
1. Add a `Certificate` model: `id`, `enrolmentId` (or `learnerId` + `courseId`), `issuedAt`, `expiresAt`, `status` (`active`/`expired`/`revoked`), `certificateNumber`.
2. On course completion where the course is tagged as a compliance/certification type, auto-issue a `Certificate` with an `expiresAt` derived from a per-course `validityMonths` field (add to `Course`).
3. Add a scheduled job `jobs/certificateExpiryJob.ts` (same pattern as the others) that finds certificates expiring within N days, sends a reminder (log/stub, same pattern as nudges), and auto-creates a new `Enrolment` in the refresher course if configured (`Course.refresherCourseId` self-relation or similar).
4. Expose `expiringCredentials` in `kpiPayload()` from a real query against `Certificate` instead of the current hardcoded `3`.
5. Frontend: show certificate status and expiry on the learner's dashboard and a compliance-coverage view for admins.

**Verify:** Test that a certificate issued with a near-term `expiresAt` shows up in the expiry job's output, and that `GET /dashboard/summary`'s `expiringCredentials` reflects a real count after seeding test certificates.

### 3.5 RSVP / waitlist workflow for sessions

**Steps:**
1. Add `capacity: Int?` to `Session`, and a new `SessionRSVP` model: `id`, `sessionId`, `learnerId`, `status` (`invited`/`confirmed`/`waitlisted`/`declined`), `respondedAt`.
2. `POST /sessions/:id/invite` (bulk-invite learners), `POST /sessions/:id/rsvp` (learner responds) — if the session is at capacity, new confirmations automatically become `waitlisted`; when a confirmed attendee cancels, promote the earliest `waitlisted` RSVP to `confirmed` and fire a reminder.
3. Add a reminder cadence job (reuse the nudge job pattern) that reminds `invited` RSVPs who haven't responded within a configurable window.

**Verify:** Test capacity handling — invite 3 learners to a session with `capacity: 2`, confirm all 3, assert 2 are `confirmed` and 1 is `waitlisted`; cancel one confirmed RSVP and assert the waitlisted one is promoted.

---

## Phase 4 — KPI Accuracy (replace hardcoded placeholders with real data)

Every item below currently returns a hardcoded value in `kpiPayload()` (`routes/index.ts`) or `computeKpis()`/`runKpiJob()` (`jobs/kpiJob.ts`). Replace each with a real aggregate:

| Field | Current | Fix |
|---|---|---|
| `trainerUtilization` | hardcoded `78` | Compute from `Session`/`Booking` records per trainer: (hours scheduled + attended) / available hours in the period. Requires deciding trainer "available hours" — confirm with the business whether this needs a trainer working-hours field on `User`. |
| `timeToCompetency` | hardcoded `14` | Compute average `(completionDate - enrolment createdAt)` in days for enrolments where `appliedAssessmentScore >= appliedThreshold`. Requires an `Enrolment.createdAt` field — add via migration if missing. |
| `expiringCredentials` | hardcoded `3` | Real count from the `Certificate` model (3.4), filtered to `expiresAt` within 30 days. |
| `weeklyActivity` | hardcoded `[]` | Aggregate `Enrolment` status changes / `Message` activity per day over the last 7 days into a real time series. |
| `dropOffHeatmap` | hardcoded `[]` | Aggregate per-module drop-off: for each `Module`, the count of enrolled learners who reached it but didn't proceed to the next module within N days. |
| CSAT / content relevance score | not present | Add a `CourseFeedback` model (`courseId`, `learnerId`, `rating`, `comment`, `submittedAt`); add `POST /courses/:id/feedback`; aggregate into the KPI payload. |
| Coverage by department/cohort | not computable | Now possible once 3.3 lands — add to the KPI payload. |

**Verify:** For each replaced field, add or extend a test in `lib/api/tests/` seeding realistic data and asserting the computed value matches a hand-calculated expectation — not just "is a number."

---

## Phase 5 — Frontend Restructuring & Test Coverage

### 5.1 Split `App.tsx` into page files

**Steps:**
1. Create `frontend/src/pages/` entries for each page currently defined inline in `App.tsx`: `Overview.tsx`, `Learning.tsx`, `Programmes.tsx`, `ProgrammeDetail.tsx`, `People.tsx`, `MyLearning.tsx`, `Assessments.tsx`, `Calendar.tsx`, `Messages.tsx`, `Reports.tsx`, `Governance.tsx`, `ReviewCredit.tsx`, `Settings.tsx`, plus the new `Register.tsx` (3.1) and `StakeholderDashboard.tsx` (2.1).
2. Move shared presentational pieces (`KpiCard`, `Skeleton`, `EmptyState`, `ErrorState`, `Status`, `ProgressLine`, `PageHeading`) into `frontend/src/components/shared/`.
3. `App.tsx` should end up as just the `QueryClientProvider`/`TooltipProvider`/`Shell`/`Router` wiring — no page logic.
4. This mirrors the structure already specified (but not followed) in `documents/Align TrainHub360 Code with the Corporate‑Training‑Platform Proposal` §3.6 — follow that section's file list.

**Verify:** `pnpm --filter frontend run typecheck` and `pnpm --filter frontend run build` both pass with no behavior change (manually click through each nav item and confirm the page renders as before).

### 5.2 Add real frontend test coverage

**Steps:**
1. `frontend/package.json` already has `"test:ui": "vitest run"` wired up but no test files exist. Add at least:
   - A render test per new page component (renders without crashing given a mocked TanStack Query client)
   - A test for the RBAC-aware nav (stakeholder role sees a reduced nav; admin sees full nav)
   - A test for the `ReviewCredit` settings page's save/error states
2. Use `@testing-library/react` (add as a dev dependency) with `vitest`.

**Verify:** `pnpm --filter frontend run test:ui` runs a non-empty suite and passes.

---

## Phase 6 — Calendar & Scheduling Depth (lower priority, do last)

### 6.1 Two-way calendar integration

**Steps:**
1. Add OAuth flows for Microsoft Graph and Google Calendar (store tokens per-user, scoped minimally to calendar read/write).
2. When a trainer schedules a session (`POST /sessions`), if the learner or trainer has a connected calendar, create a real calendar event via the relevant API instead of (or in addition to) the current `CalendarEvent` DB row.
3. Keep the existing iCal-feed-based free/busy detection in `services/nudge.ts` as a fallback for users who haven't connected Graph/Google (not every org will have this configured on day one).

**Verify:** Manual/integration test against a sandbox Microsoft/Google account creating and cancelling an event; assert the corresponding `CalendarEvent` row stays in sync.

### 6.2 Gamification / recognition layer

**Steps:**
1. Add a `Recognition` model (`id`, `userId`, `type` — e.g. `helped_peer`, `high_applied_score`, `streak` — `awardedAt`, `context`).
2. Add triggers: e.g. when an enrolment's `appliedAssessmentScore >= 90`, award a recognition; when a learner completes courses in N consecutive weeks, award a streak recognition. Keep the proposal's explicit "not vanity badges for clicking through" constraint — recognitions should only fire off applied-assessment or peer-help events, never off raw completion.
3. Surface recognitions on the learner's `MyLearning.tsx` page.

**Verify:** Test that a 95% applied score triggers a recognition record and a 40% score does not.

---

## Acceptance Criteria Summary (what "done" looks like)

- [ ] `pnpm run typecheck` and `pnpm --filter @workspace/api run test` pass with all new test files included
- [ ] A second seeded organization's data is fully invisible to the first organization's users in every route (Phase 1.2's test suite is the proof)
- [ ] A learner cannot self-approve their own review credit or create content anywhere in the system (Phase 1.3's test suite is the proof)
- [ ] Login requires and verifies a password (Phase 1.1)
- [ ] All 5 roles from §4 exist, are seeded, and have distinct, enforced permission boundaries (Phase 2.1, 2.3)
- [ ] `contentLifecycle.ts` logic runs on a schedule and produces real archive actions with audit entries (Phase 2.2)
- [ ] An organization can self-register without a manual DB seed (Phase 3.1)
- [ ] KPI dashboard numbers are all computed from real data — zero hardcoded placeholders remain in `kpiPayload()` (Phase 4)
- [ ] `App.tsx` is under ~100 lines and contains no page-level JSX (Phase 5.1)
- [ ] Frontend has a non-trivial, passing test suite (Phase 5.2)
- [ ] CI (`.github/workflows/ci.yml`) still passes end-to-end after every phase

---

## Notes for the Agent

- The gap analysis and this prompt were both produced by comparing the actual repository state to the proposal — if you find a discrepancy between what this prompt describes and what the code currently looks like (e.g. a field name that's changed), trust the code and adapt the step, but flag the discrepancy in your commit message or PR description so the human reviewer knows the prompt was slightly stale.
- Where a step says "confirm with the business" — stop and surface the open question rather than guessing; these are genuine product decisions (e.g. whether Organization Owners are hard-blocked from content, whether domain verification gates feature access), not implementation details.
- Prefer small, reviewable PRs per phase (or even per numbered step within a phase) over one giant PR — this makes it possible to ship Phase 1's security fixes immediately without waiting on Phase 6's calendar integration.
