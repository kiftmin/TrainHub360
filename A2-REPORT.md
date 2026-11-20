# A.2 — closing the eight gaps from the round 7 review

Branch: `fix/a2-email-notifications` (continues from `fix/a1-async-errors`).
Source of the gaps: `trainhub360-review-round7.md` §2 and §4. This pass closes all eight and
adds a test for each, so "closed" means "fails if it regresses".

## Verified

| Check | Result |
|---|---|
| `pnpm --filter @workspace/api run build` | clean |
| `pnpm --filter @workspace/api run test` (real SQL Server, `TrainHub360_Test`) | **120 tests, 120 pass, 0 fail, 0 skipped** (was 106) |
| `pnpm --filter @workspace/db run prisma:push` | in sync (new `email_failures` table) |
| frontend `pnpm run typecheck` | clean |
| frontend `pnpm run test:ui` | **4 files, 30 tests, all pass** (was 3 / 23) |

The suite is only meaningful with `DATABASE_URL` set: the 14 new database-backed cases in
`lib/api/tests/a2-gaps.test.js` report as skipped without it, exactly like the rest.

## The eight gaps

### 1. The console sender hid every link (done)
`consoleEmailSender` printed only `to=` and `subject=`, so in the default development setup
the activation and reset links existed nowhere. It now prints the whole message in a boxed
block, links included.

### 2. No production fail-fast (done)
`assertEmailConfiguration()` is called at startup from `index.ts`. In production it **throws**
(so the process does not start) when:
- `EMAIL_PROVIDER` is not `smtp` — the deployment would only log its mail;
- `EMAIL_PROVIDER=smtp` but `SMTP_HOST` is empty — every send would fail;
- `APP_BASE_URL` is unset, or points at localhost/127.0.0.1 — links would be unusable.

`EMAIL_STRICT=false` is the deliberate opt-out. In development the same findings are printed
as notices, so the console sender stays usable.

### 3. Send failures were invisible (done)
`.catch(() => false)` and the empty catch in `notify()` are gone. A failed send is logged
(`[email] send failed to=… kind=…`) and written to a new **`email_failures`** table
(`services/emailFailures.ts`, pruned after 30 days). The API now also tells the caller:
`POST /users` and `POST /users/:id/resend-activation` return `emailSent`, and the in-app
notification insert logs its own failure instead of dropping it.

### 4. The reset link landed nowhere (done)
- New page `frontend/src/pages/ResetPassword.tsx`, mounted in `App.tsx` at
  `/reset-password` **before** the auth check, the same way `/activate` is. It reads the
  token from the query string, posts it with the new password, and shows the server's message
  for an expired token.
- `Login.tsx` lost its paste-a-token mode and the "check the backend console" notice; the
  forgot-password form now says the link is in the inbox.

### 5. Resend activation and activation status were not in the UI (done)
- `GET /users` returns `activatedAt` to org staff (never to programme admins).
- **People** gained an *Activation* column (*activated* / *invited*), an *Invited* KPI, and a
  **Resend invite** button on anyone who has not activated, with a confirmation or the reason
  the send failed.

### 6. The bell's badge never appeared until it was opened (done)
`useUnreadNotificationCount()` requests `GET /notifications?unread=true&limit=1` on load and
once a minute. The panel still loads the list when opened; while it is open its own response
is authoritative.

### 7. HTML injection in the activation email (done)
The name is escaped with the shared `escapeHtml()` before it goes into the body (and the link
is escaped too). The same helper replaced the ad-hoc escaping in `notify()`.

### 8. The login throttle was switched off in tests (done)
`loginThrottleDisabledForTests()` is gone and the throttle is always live. What is
configurable now is the limits and the window — `LOGIN_THROTTLE_ENABLED`,
`LOGIN_THROTTLE_WINDOW_MS`, `LOGIN_THROTTLE_ACCOUNT_LIMIT`, `LOGIN_THROTTLE_IP_LIMIT`, plus
`configureLoginThrottle()` for a test. `tests/a2-gaps.test.js` turns the limit down to 3 and
proves both halves: N failures lock out even a correct password with the same generic 401,
and a successful login resets the counter.

## Tests added

`lib/api/tests/a2-gaps.test.js` — 14 cases: the console body (1), the six production
configuration cases (2), escaping (7), a recorded send failure (3), `activatedAt` plus
resend-activation org-scoping and the 409 once activated (5), the cheap unread-count request
(6), and the two throttle cases (8).

`frontend/src/a2-gaps.test.tsx` — 7 cases: the reset page (no token, success, mismatched
passwords, expired token), the login page no longer asking for a token, the badge on load
without fetching the list, and People's activation state with resend.

## Files touched

- `lib/api/src/services/email.ts` — body logging, `escapeHtml`, `emailConfigurationProblems`, `assertEmailConfiguration`
- `lib/api/src/services/emailFailures.ts` — new
- `lib/api/src/services/password.ts` — escaped activation mail, recorded failures, `emailSent`
- `lib/api/src/services/notify.ts` — failures logged and recorded
- `lib/api/src/middleware/rateLimit.ts` — configurable, always live
- `lib/api/src/routes/index.ts` — throttle call sites, `activatedAt`, `emailSent`
- `lib/api/src/index.ts` — startup assertion
- `lib/db/prisma/schema.prisma` — `EmailFailure` model
- `frontend/src/pages/ResetPassword.tsx` — new
- `frontend/src/App.tsx`, `pages/Login.tsx`, `pages/People.tsx`, `components/NotificationBell.tsx`, `api/hooks.ts`
- `.env.example`, `README.md`, `LOCAL-TESTING-A1-A2.md`

## Still open (unchanged by this pass)

- **A.3:** multipart uploads, a `StoredFile` model, org-bound file ids — uploads still fail
  above ~75 KB.
- **Phase B:** trainer-by-id and the cross-tenant rename write, thread access for removed
  members, the RSVP fixes, session/join-link visibility, and the unverified items
  (`GET /users` field restriction is now only partly closed by `activatedAt`, the `UserRole`
  migration script, leftover `requireRole` uses).
- **Phase C:** assessment builder completion and the assessment → enrolment → certificate →
  review-credit loop.
- **Phase D:** reminder cadence and `.ics` attachments.
- **Phase E:** content integrity, the verification UI and the small fixes.
