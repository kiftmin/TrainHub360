# TrainHub360 — Corporate Training & Development Platform
### Product Proposal v1.0

---

## 1. The Opportunity

Corporate training software is a large and growing category — the market is on track to pass $27B by 2030 — but the research is consistent on one point: most platforms deliver *content management*, not *training outcomes*. Buyers keep switching vendors, L&D teams keep complaining, and the same failure patterns show up across nearly every review site and industry report. That gap is the opening.

This proposal reframes the idea from "another LMS with trainers, learners and courses" into a platform purpose-built for **corporate L&D teams and training managers**, engineered specifically against the failure modes documented below — with governance, engagement, and measurable ROI as first-class design goals rather than bolt-ons.

---

## 2. What's Actually Wrong With Existing Platforms

Pulling together current industry analysis (2025–2026) on why corporate LMS platforms underperform:

**Engagement is an afterthought, not a design principle.**
Low completion and re-engagement are the most-cited failure across the category. The root causes repeat everywhere: training feels disconnected from the employee's actual job, content is generic rather than role-specific, courses are long and passive (slides/video with no interaction), and progress is invisible so learners feel stuck even mid-course. Crucially, high completion numbers are frequently a false signal — employees "click through" compliance modules without absorbing anything, which platforms don't distinguish from genuine learning.

**Completion rate is treated as the success metric, when it's really just a hygiene metric.**
Multiple sources make the same point: a 100%-completion, 95%-pass-rate module can represent zero real learning if the quiz was trivial and the learner just guessed. Platforms that stop at "did they finish" give training managers a false sense of program health.

**Admin burden and reporting are weak.**
A recurring theme in 2026 reviews is that LMS platforms become "a bottleneck instead of a strategic asset" — heavy administrative workload, limited reporting, and difficulty proving compliance during an audit (which should be a reporting click, not a research project).

**One-size-fits-all structure doesn't match how real organizations are shaped.**
Generic platforms force every learner into a flat list rather than reflecting how the organization is actually structured (departments, programmes, cohorts, certification tracks) — a specific complaint about "corporate LMS" vs. generic/academic tools.

**Adoption is measured shallowly.**
Login counts and completions are easy to track but say little about *voluntary* engagement — repeat visits without reminders, exploring beyond mandatory content, or referencing material back on the job. Most platforms have no way to see or reward this.

**Friction kills momentum.**
When a learner hits something they don't understand and there's no one to ask, they don't fail the course — they just quietly stop and never come back. Very few platforms have a real mechanism (human or AI) for unblocking someone in the moment.

### What this means for the build
Every one of these is solvable with intentional design — not more content, but better mechanics: visible progress, role-relevant assignment, real interaction, a distinction between *completion* and *competence*, a structure that mirrors the org chart, and low-friction ways to get unstuck. Section 5 addresses each directly.

---

## 3. Target Audience & Positioning

**Primary buyer:** Corporate L&D / Training Managers and HR leaders at mid-to-large organizations who currently juggle spreadsheets, a generic LMS, calendar invites, and WhatsApp/email for what should be one connected workflow.

**Positioning statement:**
*"TrainHub360 is the training platform corporates actually asked for: one that proves training worked, not just that it happened."*

The wedge against incumbents (Docebo, Cornerstone, Absorb, TalentLMS, Litmos, 360Learning) isn't feature parity — it's:
1. Purpose-built for **internal staff training** (not customer education or academic use), so the data model matches how corporates run programmes: org → programme → administrator → trainer → cohort → learner.
2. **Manager-facing KPI dashboards from day one**, not an add-on analytics module.
3. **Competence over completion** baked into the assessment engine.
4. Multi-org, multi-tenant from the ground up (an organization registers, manages its own users, branding, and data boundary).

---

## 4. User Roles & Core Workflows

| Role | Who | Core capabilities |
|---|---|---|
| **Organization Owner** | The corporate account holder | Registers the org, sets up billing/branding, appoints Programme Administrators, views org-wide KPI rollups |
| **Training Programme Administrator** | Appointed per programme | Adds/removes trainers and learners, creates courses, manages enrolments, sets certification/compliance rules, owns programme-level reporting |
| **Trainer** | Subject-matter expert / facilitator | Uploads course material, links external courses, schedules sessions (online/offline), sends invitations, grades assessments, runs 1:1s, messages learners |
| **Learner** | Employee | Views assigned courses, tracks progress, takes tests, sees results, books 1:1 sessions, DMs trainers, manages their schedule |
| **Stakeholder (view-only)** | Department head, exec sponsor | Read-only dashboards scoped to their department/cohort — no editing rights |

A single person can hold more than one role (e.g., a Trainer who is also a Programme Administrator) — role assignment is per-programme, not global, so permissions don't leak across programmes an org runs concurrently.

---

## 5. Feature Set — Designed Against the Failure Modes

### 5.1 Organization & Programme Setup
- Self-service org registration with domain verification (reduces fake/duplicate org signups)
- Org structure mirrors the real org chart: divisions → departments → programmes — not a flat learner list
- Multiple concurrent training programmes per org, each with its own administrator, budget code, and KPI targets
- Bulk learner import (CSV/HRIS sync) with role auto-mapping

### 5.2 Trainer Tools
- Course builder supporting native content, uploaded files, and links to external courses (Coursera/LinkedIn Learning/etc.) — tracked as a single unified record either way
- Scheduling engine for online (video link) and offline (room/location) sessions, with calendar sync (Outlook/Google)
- Invitation and RSVP workflow with automatic waitlisting and reminder cadences
- Direct messaging with learners (see 5.5 — this is the friction-reducer the research flags as missing)
- Assessment builder that separates **recall questions** from **applied/scenario questions**, so competence can be measured distinctly from completion

### 5.3 Learner Experience
- Single dashboard: assigned courses, upcoming sessions, latest results, certificates
- **Visible progress mechanics** — progress bars, milestones, and "what's next" prompts, directly targeting the "invisible progress = abandonment" failure mode
- One-click 1:1 session booking with any trainer they're enrolled under (real-time availability, not email back-and-forth)
- Direct messaging (DM) to trainers, with an SLA-style "usually responds within X hours" indicator
- Mobile-first design — training that competes with a phone screen, not a laptop-only portal, since most disengagement research points to training losing out to "real work" when it's inconvenient

### 5.4 Engagement Layer (this is the differentiator)
- **Role-relevant assignment**: courses tagged by job function/skill, not blasted to everyone
- **Micro-learning support**: trainers can break long courses into short modules with natural stopping points
- **Competence-weighted completion**: a course isn't "done" until the applied-assessment threshold is met, not just the last slide viewed
- **Streaks/recognition, not vanity gamification**: recognition tied to real behaviors (helping a peer, completing a scenario assessment well) rather than empty badges for clicking through
- **Nudge intelligence**: instead of blanket reminder emails, nudges are timed to when a learner has natural gaps in their calendar (via calendar integration)
- **In-context help**: a learner stuck on a concept can flag it inline and either DM the trainer or get routed to an AI-assisted explainer, directly addressing the "silent abandonment" failure mode

### 5.5 Communication
- DMs are threaded per course/programme (so a trainer with 200 learners across 3 programmes isn't managing one giant inbox)
- Trainer messaging includes canned-response templates and an "urgent" flag that escalates to the Programme Administrator if unanswered past a set window — this is a governance safeguard, not just a chat feature

---

## 6. Making It "Foolproof and Bulletproof" — Governance & Trust Layer

This is where the platform earns the corporate buyer's trust, and it directly answers the "heavy admin burden / weak audit trail" complaint from the research:

- **Full audit trail**: every enrolment, grade change, certificate issuance, and permission change is logged with who/when — turns compliance audits into a report export, not a fire drill
- **Role-based access control (RBAC)** enforced at the programme level, so a Programme Administrator in one programme cannot see or touch another programme's data within the same org
- **Data integrity safeguards**: no course can be marked "complete" without meeting its defined assessment threshold — prevents the "checkbox completion" problem structurally, not just by policy
- **Compliance/certification expiry tracking**: automatic re-certification reminders before a compliance credential lapses (a named gap in current tools)
- **SSO/SAML support** for enterprise IT requirements, and data residency options for multi-region corporates
- **Approval workflows**: certain actions (e.g., bulk-removing learners, deleting a programme) require a second admin's sign-off — reduces costly accidental changes

---

## 7. Optional Module: Performance Review Credit

A configurable, **org-level toggle** (default: off) that lets a business link training outcomes to an employee's performance review score. Because this touches HR-sensitive territory, it's designed as an opt-in module rather than a core mechanic — an org that doesn't want training tied to reviews simply never switches it on, and nothing else in the platform depends on it.

**Why it needs care:** if raw completion feeds a review score, it recreates the exact "checkbox completion" problem this whole proposal is built to avoid — people rush content to protect their rating instead of actually learning. The module is designed to close that loophole structurally.

**Design principles:**
- **Competence-weighted, not completion-weighted.** The credit is calculated from the applied-assessment score (Section 5.4/5.5's competence engine), not from "viewed the last slide." Raw completion alone can never generate review credit.
- **Capped and transparent.** When the Org Owner enables the module, they set a maximum weighting (e.g. training can contribute up to X% of the overall review score) — visible to learners upfront, not a hidden multiplier.
- **Manager sign-off required.** The platform surfaces a suggested training-credit value; it never auto-writes into a review. The line manager confirms or adjusts it as part of the normal review process. The platform is the evidence source, not the review system.
- **Blended signal, not single-metric.** Credit draws on assessment score, on-time completion against deadline, and (optionally) the manager's own on-the-job application rating already captured in the KPI set — so no single number can be gamed.
- **Compliance training excluded by default.** Mandatory/compliance courses are pass-fail and shouldn't swing a review score the same way voluntary upskilling does — an org enabling the module chooses which programme types are eligible.
- **Appeals path.** A learner can flag a disputed score (bad quiz question, session no-show due to a system issue) for admin correction before it locks into a review cycle.

### 7.1 The Scoring Formula

Review credit is calculated **per enrolment**, then aggregated across all eligible enrolments in a review period. The formula is transparent and auditable.

**Per-Enrolment Score (0–100 scale):**

```
ENROLMENT_SCORE = (A × WA) + (B × WB) + (C × WC)

Where:
  A = Applied Assessment Score (0–100)
      The learner's score on applied/scenario assessments only.
      Recall questions are excluded — only competence-demonstrating work counts.
      If no applied assessment exists, A defaults to 0 (no credit without proof of competence).

  B = Timeliness Score (0–100)
      100 if completed by deadline
      50 if completed 1–7 days late
      25 if completed 8–30 days late
      0 if incomplete or >30 days late

  C = On-the-Job Application Score (0–100) [OPTIONAL, requires manager input]
      The line manager rates, post-course, whether the learner applied the
      new skill in their actual role (1–5 scale, converted to 0–100).
      If manager does not submit, C is excluded and weights are renormalized.

  WA = Weight for Applied Assessment (default: 50%)
  WB = Weight for Timeliness (default: 30%)
  WC = Weight for Application (default: 20%, only if submitted)

Org Owner can adjust WA, WB, WC at setup, but all must sum to 100%.
```

**Example 1: Learner completes on time with strong competence, no manager rating yet**
```
A = 85 (passed applied assessment at 85%)
B = 100 (completed by deadline)
C = not yet submitted → excluded, weights renormalized to WA=63%, WB=38%

ENROLMENT_SCORE = (85 × 0.63) + (100 × 0.38) = 53.55 + 38 = 91.55
```

**Example 2: Learner completes late, moderate assessment score, manager confirms applied the skill**
```
A = 72 (passed applied assessment at 72%)
B = 50 (completed 5 days late)
C = 80 (manager rates "regularly uses the new skill in role")

ENROLMENT_SCORE = (72 × 0.50) + (50 × 0.30) + (80 × 0.20) = 36 + 15 + 16 = 67
```

**Example 3: Learner fails to complete**
```
A = 0 (no assessment taken)
B = 0 (incomplete)
C = 0 (N/A)

ENROLMENT_SCORE = 0
No review credit issued.
```

---

**Aggregation to Review Period (0–100 scale):**

For a single review cycle, the learner's training credit score aggregates their enrolment scores:

```
REVIEW_CREDIT_RAW = MEAN(all eligible ENROLMENT_SCORE values in review period)

REVIEW_CREDIT_FINAL = (REVIEW_CREDIT_RAW / 100) × ORG_MAX_WEIGHTING

Where:
  REVIEW_CREDIT_RAW = average of all enrolment scores (0–100)
  ORG_MAX_WEIGHTING = org-configured max % (e.g., if org says training is worth
                       up to 10% of review score, this is 10)
  REVIEW_CREDIT_FINAL = the actual points/percentage contributed to the review

For display purposes:
  If learner completed 3 eligible courses with scores [91.55, 67, 88],
  REVIEW_CREDIT_RAW = (91.55 + 67 + 88) / 3 = 82.18
  
  If ORG_MAX_WEIGHTING = 10%,
  REVIEW_CREDIT_FINAL = (82.18 / 100) × 10 = 8.218 points
```

### 7.2 Exclusions & Overrides

**Automatic exclusions (never generate review credit):**
- Compliance/mandatory training programmes (unless Org Owner explicitly tags a compliance course as review-eligible, which is rare)
- Courses with no applied assessment (assessment type must be marked "applied" or "scenario")
- Enrolments still in progress at review snapshot date
- Courses opted out by the Programme Administrator (`review_credit_eligible = false`)

**Manual overrides (Programme Administrator or Org Owner):**
- **Appeal resolution:** if a learner flags a disputed score, admin can manually adjust A, B, or C before it locks, with an audit note
- **Extenuating circumstances:** if an enrolment should be excluded (e.g., learner on medical leave during course), admin can mark it `review_credit_excluded = true` with a reason logged

### 7.3 Settings Surface (Org Owner Only)

- **Module on/off** toggle
- **Max % weighting** toward review score (e.g., 5%, 10%, 15% — org's choice)
- **Review period** (e.g., aligned to calendar year, fiscal year, or custom dates)
- **Eligible programme types** (checkboxes: Compliance, Onboarding, Professional Development, Certification, Other)
- **Weight distribution** (sliders for WA, WB, WC — must sum to 100%)
- **Manager sign-off required** (on by default, enforced at export/finalization time; cannot be disabled)
- **Application score collection** (on/off — if off, manager ratings are not collected and C is always excluded)

### 7.4 Data Model Additions

New fields on the `Enrolment` record:

| Field | Type | Description |
|---|---|---|
| `review_credit_eligible` | boolean | Set by Programme Administrator; determines if this enrolment can generate review credit. Default: inherited from course config, overridable per-enrolment. |
| `applied_assessment_score` | decimal (0–100) | Extracted from the learner's highest passing attempt on an assessment tagged `assessment_type = 'applied'`. Null if no applied assessment exists. |
| `completion_date` | timestamp | When the learner completed the course (marked competent). |
| `deadline_date` | timestamp | Deadline set by Programme Administrator; used to calculate timeliness score. Null = no deadline, timeliness score defaults to 100. |
| `timeliness_score` | decimal (0–100) | Calculated: 100 if completed ≤ deadline, 50 if 1–7 days late, 25 if 8–30 days late, 0 if >30 days or incomplete. |
| `application_score` | decimal (0–100) | Submitted by line manager post-course, optional. Scale 1–5 converted to 0–100. Null if not submitted. |
| `application_score_submitted_by` | uuid (user_id) | The manager who submitted the application score. |
| `application_score_submitted_at` | timestamp | When the manager submitted it. |
| `enrolment_score` | decimal (0–100) | The calculated ENROLMENT_SCORE per the formula above. Recalculated whenever A, B, or C changes. |
| `review_credit_excluded` | boolean | Manual override; if true, this enrolment is ignored in review period aggregation. Default: false. |
| `review_credit_exclude_reason` | text | Audit note (e.g., "Medical leave during course," "Disputed score under appeal"). |
| `review_credit_locked_at` | timestamp | Once a review cycle concludes, this timestamp locks the score. Edits after this require override privileges. |
| `manager_sign_off` | boolean | Line manager explicitly confirms the enrolment score before it's finalized. Null = pending sign-off. |
| `manager_sign_off_by` | uuid (user_id) | The manager who signed off. |
| `manager_sign_off_at` | timestamp | When sign-off occurred. |

New fields on the `Organization` record (configuration):

| Field | Type | Description |
|---|---|---|
| `review_credit_module_enabled` | boolean | Module toggle (default: false). |
| `review_credit_max_weighting` | decimal (0–100) | Max % of review score training can contribute (e.g., 10 = 10%). |
| `review_credit_period_start` | date | Start of review period (e.g., Jan 1 for calendar year). |
| `review_credit_period_end` | date | End of review period (e.g., Dec 31 for calendar year). |
| `review_credit_weight_assessment` | decimal (0–100) | WA (default: 50). |
| `review_credit_weight_timeliness` | decimal (0–100) | WB (default: 30). |
| `review_credit_weight_application` | decimal (0–100) | WC (default: 20). |
| `review_credit_eligible_programme_types` | array (string) | e.g., ["Professional Development", "Certification"]. Compliance excluded by default. |
| `review_credit_require_manager_signoff` | boolean | If true, enrolment score must be confirmed by line manager before finalization (default: true, cannot be disabled). |
| `review_credit_collect_application_scores` | boolean | If true, Platform invites manager to rate on-the-job application post-course (default: true). |

New read-only computed fields on the `Learner` record (per review period):

| Field | Type | Description |
|---|---|---|
| `review_period_total_eligible_enrolments` | integer | Count of enrolments that could generate review credit in this period. |
| `review_period_completed_enrolments` | integer | Count of eligible, completed enrolments. |
| `review_credit_raw` | decimal (0–100) | REVIEW_CREDIT_RAW: mean of all enrolment scores. |
| `review_credit_final` | decimal | REVIEW_CREDIT_FINAL: points to contribute to review (org max weighting applied). |
| `review_credit_pending_manager_signoff_count` | integer | Count of enrolments awaiting manager sign-off. |
| `review_credit_locked` | boolean | If true, review period is closed and scores are immutable without override. |

---

### 7.5 API Export & Integration

The platform exports review credit data via:
- **CSV export** (for manual import into performance review tools)
- **REST API endpoint** (`/api/v1/organizations/{org_id}/review-credits?period=2025-01-01_2025-12-31`) for HRIS system integration
- **Webhooks** (on review period close, POST `review_credit_finalized` event to registered HRIS endpoints)

Data includes: learner name/ID, total enrolments, review credit raw, review credit final, manager sign-off status, and audit trail (who approved, when, any appeals/overrides).

This keeps TrainHub360 as the authoritative training evidence source, not the review system itself — orgs plug the data into whatever performance-management tool they already use.

---

## 8. KPI & Analytics — Built for Training Managers, Not Bolted On

The research is clear that training managers are evaluated on far more than completion rates. TrainHub360's dashboard should be structured around the standard L&D measurement categories (Kirkpatrick-aligned: Reaction, Learning, Behavior, Results, ROI) plus engagement and time metrics:

**Reaction & Satisfaction**
- Post-session/course satisfaction score (CSAT/NPS-style)
- Content relevance score, per course and per trainer

**Learning**
- Pass/fail rates and score distributions (not just averages — flags courses that are too easy or too hard)
- Knowledge retention rate (delayed re-test, e.g., 30/60/90 days post-course)

**Engagement (distinct from completion — addressing the core research finding)**
- Active participation rate (quiz attempts, discussion posts, session attendance vs. no-shows)
- Voluntary/repeat usage rate — learners returning without a reminder
- Time-to-start and time-to-complete, to flag procrastination patterns early

**Behavior & Application**
- Manager-rated on-the-job skill application (structured pre/post manager assessment, built into the platform rather than a side spreadsheet)
- Time-to-competency for onboarding/reskilling programmes

**Results & ROI**
- Cost per learner / per programme, and cost vs. budget
- Error-rate or quality-metric change post-training (where the org feeds in operational data)
- Training ROI (value delivered vs. programme cost)

**Compliance & Coverage**
- % of workforce trained by required course, with expiry/renewal status
- Coverage by department/cohort, so gaps are visible before an audit, not during one

**Operational**
- Trainer effectiveness and load (sessions run, response time, learner ratings)
- Programme-level and org-level rollup dashboards, with drill-down by department — matching how a real Training Manager reports up to an exec sponsor

All KPIs are exportable and schedulable (weekly/monthly digest to stakeholders), because the research also flags "reporting shouldn't be an admin project."

---

## 9. High-Level Data Model

```
Organization
 └── Programme (owned by Programme Administrator)
      ├── Trainers (assigned)
      ├── Courses (native content / external links)
      │    ├── Modules
      │    └── Assessments (recall + applied)
      ├── Sessions (online/offline, scheduled)
      │    └── Invitations / RSVPs
      ├── Cohorts / Learner groups
      └── Enrolments (learner × course, with status + audit trail)

Learner
 ├── Enrolments (across programmes)
 ├── 1:1 Bookings
 ├── DM threads (per programme/trainer)
 └── Certificates / compliance records
```

This maps cleanly onto a relational schema (Postgres) with row-level security by organization — a natural fit if built on your existing stack (Express, Drizzle ORM, Postgres/Neon), with React/TanStack Query on the front end.

---

## 10. MVP vs. Phase 2

**MVP (prove the core loop)**
- Org registration, programme setup, role assignment
- Course creation (native + external links), scheduling, invitations
- Learner dashboard, progress tracking, DMs, 1:1 booking
- Core KPI dashboard (completion, engagement, pass/fail, coverage)
- Audit trail + RBAC

**Phase 2 (the differentiators that build a moat)**
- Competence-weighted completion + delayed retention testing
- Nudge intelligence tied to calendar gaps
- Manager pre/post skill-application assessments
- AI-assisted in-context help for stuck learners
- HRIS/SSO integrations, compliance expiry automation
- Advanced ROI/cost modeling per programme
- Optional Performance Review Credit module (Section 7) — sits in Phase 2 since it depends on the competence-weighted scoring engine being live first

---

## 11. Why This Wins

Every major complaint in the current market — checkbox completion, invisible progress, generic content, weak reporting, poor adoption visibility, silent learner drop-off — has a specific, structural answer in this design rather than a generic "we'll add gamification" fix. That's the difference between another LMS and a platform training managers will actually champion internally, because it gives them the one thing every source agrees they're missing: proof that training worked.
