# TrainHub360 — Review of the Round 6 Fix Pass (branches `fix/a1-async-errors`, `fix/a2-email-notifications`)

**What was pushed:** two stacked branches, not `main`. `main` is still at `ded8dda`.
- `fix/a1-async-errors` (PR #1): Phase A.1, plus the Phase F test and CI work.
- `fix/a2-email-notifications`: A.1 plus Phase A.2.

**Not pushed:** A.3 (uploads), and all of Phases B, C, D and E. Nothing for them exists on any branch.

**Method and limits:** static read of the branch code and reports. I can't run Prisma, SQL Server or GitHub Actions from my sandbox, so the test numbers below (98 passed, 0 skipped) are the agent's own report in `A1-REPORT.md`, not something I verified.

---

## 1. Phase A.1 and the CI work: good

**Async errors (H1)**
- `express-async-errors` is imported before the router is created, with a comment explaining why the order matters.
- The error middleware maps a numeric `status` to that status. Only a real `PrismaClientKnownRequestError` with a connectivity code (`P1001`, `P1002`, `P1017`) becomes 503. Everything else is logged and returned as a generic 500, with no internals leaked.
- There are 7 tests, each with a 3-second abort so a hang fails instead of stalling: cross-org requests return 404 promptly, the last admin can't be demoted through `roles` (409), a learner gets 403, and an unexpected throw returns a generic 500.

**A real bug the new tests found:** the `roles`-array path on `PATCH /programmes/:id/members/:userId` was unreachable, because the single-grant guard ran first and returned 400. It was fixed.

**Tests no longer skip silently (F.1, F.2):**
- With `CI=true`, a missing `DATABASE_URL` throws.
- CI now starts a SQL Server 2022 container, applies the schema and runs the suite against it.
- A separate frontend CI job typechecks and tests the frontend.
- The report says CI had been "green and meant nothing" before this. Running against a real database immediately exposed four faults (a roles upsert race, a login test that needed its own organization, order-dependent member tests, and a throttle collision). All four were fixed.

**Honest reporting:** `A1-REPORT.md` states what was changed, what only a real database caught, and its open items (a GitGuardian flag on the throwaway CI password, and a 5-second transaction timeout in `rbac.test.js` that failed once under load).

---

## 2. Phase A.2 (email, links, activation, bell): partly done

**Done:**
- An SMTP sender (nodemailer) selected by `EMAIL_PROVIDER=smtp`. With `smtp` selected but `SMTP_HOST` missing, it throws at send time instead of silently falling back to the console.
- Activation and reset emails now carry absolute links built from `APP_BASE_URL`.
- An Activate page, reachable before login, with tests for missing token, success, mismatched passwords and an expired token.
- A notification bell and API (`GET /notifications`, mark one read, mark all read), scoped to the caller, with tests.

**Not done or incomplete against the prompt:**

| # | Gap | Detail |
|---|---|---|
| 1 | **The console sender still doesn't log the message body or links.** | It logs only recipient and subject. The prompt required full body and links outside production. In the default development setup (no `EMAIL_PROVIDER`) activation and reset links are still invisible anywhere. The only token that gets logged is the old organization-registration one. |
| 2 | **No production fail-fast.** | Nothing refuses to start when no real provider is configured, and nothing requires `APP_BASE_URL` in production. With the defaults, a production deployment silently sends mail to the console and links to `http://localhost:5173`. The agent recorded this as a [CONFIRM] decision for the missing-`SMTP_HOST` case only. |
| 3 | **Send failures are invisible.** | Activation, reset and notification sends all end in `.catch(() => false)` and `notify` has an empty `catch`. Nothing is logged and no failed-send record exists, which the prompt asked for. |
| 4 | **The password-reset link doesn't land anywhere.** | The email now links to `/reset-password?token=…`, but the frontend has no such route. The app shows the login page and ignores the token. The reset form still asks the user to paste the token manually, and its notice still says "Check the backend console for the token in local dev", which the backend no longer prints. |
| 5 | **Resend activation and activation status are not in the UI.** | The `POST /users/:id/resend-activation` route exists, but no page uses it. People doesn't show who has activated. |
| 6 | **The bell's unread badge never appears until the bell is opened.** | `useNotifications(open)` only runs while the panel is open, so the count is unknown on page load. The component comment says "an idle workspace makes no polling requests" and treats that as a feature, but it defeats the purpose of a badge. It needs a lightweight unread-count request on load (and a slow refresh). |
| 7 | **HTML injection in the activation email.** | The HTML body inserts the user's `name` without escaping (`<p>Hello ${name},</p>`). An org admin who creates a user can put markup or a link in the name, and it arrives in an email from the platform's own address. Escape it (the `toHtml` helper already shows how). |
| 8 | **The login throttle is switched off under `NODE_ENV=test`.** | That was needed to stop test files interfering with each other, but it means the throttle (per IP and per account) is not exercised by any integration test. Make the throttle configurable (for example, an injectable key or limit) so a dedicated test can turn it on. |

---

## 3. Not started

- **A.3:** multipart uploads, a `StoredFile` model, and org-bound file ids. Uploads still fail above about 75 KB.
- **Phase B:** trainer-by-id and the cross-tenant rename write, thread access for removed members, RSVP fixes, session and join-link visibility, and the unverified items (`GET /users` fields, the `UserRole` migration, leftover `requireRole` uses).
- **Phase C:** the assessment builder completion and the assessment → enrolment → certificate → review-credit loop.
- **Phase D:** reminder cadence and `.ics` attachments.
- **Phase E:** content integrity, the verification UI and the small fixes.

---

## 4. Verdict

Phase A.1 and the CI work are solid, and the CI change is the most valuable thing in this push, because the suite now fails when it can't run. Phase A.2 is about two-thirds done: sending real email and absolute links work, but the user-facing flows (activation in dev, password reset from the email link, the unread badge) still don't work end to end, and the production guards are missing.

Before merging, I'd fix A.2 items 1, 2, 3, 4, 6 and 7. Items 5 and 8 can follow with the next phase. Then continue with A.3 and Phases B–E.
