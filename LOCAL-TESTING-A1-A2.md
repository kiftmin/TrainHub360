# Testing the A.1 + A.2 changes locally

Branch to test: `fix/a2-email-notifications` (contains `fix/a1-async-errors` too).
Repo: `C:\projects\TrainHub360`

Three things get tested here: the **API suite** against your real SQL Server, the
**frontend** typecheck + tests, and then the **actual pages** — the activation flow and the
notification bell — in a browser.

---

## 0. Get the branch

```powershell
cd C:\projects\TrainHub360
git fetch origin
git checkout fix/a2-email-notifications
git pull
```

---

## 1. API suite against the database

Your `.env` in the repo root must point at the **test** database (not `TrainHub360`):

```
DATABASE_URL="sqlserver://localhost:1433;database=TrainHub360_Test;user=trainhub_test;password=…;trustServerCertificate=true"
JWT_SECRET="test-secret-round6"
PORT="4000"
```

Then, from the repo root:

```powershell
# rebuild from clean — a stale tsbuildinfo makes tsc claim "up to date" with no dist/
Remove-Item lib\db\dist, lib\api\dist -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item lib\db\tsconfig.tsbuildinfo, lib\api\tsconfig.tsbuildinfo -ErrorAction SilentlyContinue

pnpm install
pnpm --filter @workspace/db run prisma:generate
pnpm --filter @workspace/db run prisma:push        # applies the schema to TrainHub360_Test
pnpm --filter @workspace/api run build
pnpm --filter @workspace/api run test
```

**Expect:** `tests 120`, `pass 120`, `fail 0`, `skipped 0`, about 45 s.

- `skipped` **must be 0**. If you see skips, `DATABASE_URL` was not read — check the `.env`
  location (repo root, not `lib/api`).
- `[email] to=… subject=…` lines in the output are the console sender working, which is the
  expected default. That is what A.2 replaced with a real one.
- `[api] unhandled error: TypeError: kaboom` is the 500 test throwing on purpose.

### Checking CI's "no silent skips" rule

**`$env:DATABASE_URL=""` will not do it**, and it is worth knowing why: every database suite
loads the repo-root `.env` with dotenv, and dotenv treats an empty variable as unset — so it
puts the real URL back and all 120 tests run green. That looks like a broken guard; it isn't.

Use the dedicated script, which deletes `DATABASE_URL` (so the `.env` cannot supply one
either) before any suite loads:

```powershell
cd C:\projects\TrainHub360
$env:CI="true"
pnpm --filter @workspace/api run test:ci
Remove-Item Env:\CI
```

You should see `DATABASE_URL is not set. CI must run the API suite against a real SQL Server`
and a non-zero exit.

To test the guard without the whole suite, this is quick and unambiguous:

```powershell
cd C:\projects\TrainHub360\lib\api
$env:CI="true"
node --import ./tests/support/ci-no-env.js -e "const { requireDatabase } = await import('./tests/support/requireDatabase.js'); try { requireDatabase('x'); console.log('NO THROW (bad)'); } catch (e) { console.log('throws:', e.message.slice(0,60)); }"
```

Limitation: `node --test` gives every test file its own process and runs the preload in that
child, so a suite that loads `.env` itself still connects. `test:ci` is a guard against
"did I really unset it", not a sandbox.

---

## 2. Frontend typecheck + tests

The frontend is **not** part of the root pnpm workspace — it has its own lockfile, so it
installs on its own:

```powershell
cd C:\projects\TrainHub360\frontend
pnpm install --ignore-workspace --frozen-lockfile
pnpm run typecheck
pnpm run test:ui
```

**Expect:** typecheck silent, then `Test Files 4 passed`, `Tests 30 passed`.

Two gotchas:
- Without `--ignore-workspace` pnpm walks up and installs the backend instead.
- The tests need **Node 22+** (jsdom 30 needs it). On Node 20 you get
  `webidl.util.markAsUncloneable is not a function`. `node -v` to check.

The 7 A.2 cases are in `frontend/src/a2-notifications.test.tsx` — activation page (no token,
success, mismatched passwords, expired token) and the bell (list, badge, click-through marks
read, empty state). The 7 gap cases are in `frontend/src/a2-gaps.test.tsx` — the reset page,
the badge on load, and People's activation state with resend.

---

## 3. Try the actual pages in a browser

Two terminals.

**Terminal 1 — API:**

```powershell
cd C:\projects\TrainHub360
$env:PORT="4000"
pnpm --filter @workspace/api run dev
```

**Terminal 2 — frontend:**

```powershell
cd C:\projects\TrainHub360\frontend
pnpm run dev
```

Open http://localhost:5173 and sign in (`admin@example.com` / `ChangeMe123!` if you seeded
the test DB).

### 3a. The notification bell

The bell in the top-right now shows a real unread count instead of a permanent dot.

1. Click it — the panel opens and loads your notifications (empty state on a fresh DB:
   "Nothing yet. Activity on your programmes shows up here.").
2. To put something in it, book a session for a learner, or run the certificate-expiry job
   from Settings. The in-app record is created by `notify()`.
3. Click a row that has a link — it should mark that one read and navigate you there.
4. Reopen: the badge count drops. "Mark all read" clears it.

The badge is right **before** the panel is opened: a single cheap request
(`GET /api/notifications?unread=true&limit=1`) runs on load and once a minute after that, so
a notification that arrives while you work shows up without a reload. Opening the panel is
still what loads the list itself.

### 3b. The activation page

This is the one the old code got wrong (links were sent as bare `/activate?token=…`).

1. As an org admin, add a learner in **People** with an email you can read.
2. Watch Terminal 1 — the console sender now prints the **whole message**, body and link
   included, between `─── [email] ───` lines:

```
─────────────────────────────── [email] ───────────────────────────────
to:      learner@example.com
subject: Activate your TrainHub360 account

Hello Learner, activate your TrainHub360 account (valid 7 days):
http://localhost:5173/activate?token=1f3c…
───────────────────────────────────────────────────────────────────────
```

3. Copy that link and open it. (No SMTP catcher needed any more. The stored token is a
   hash, so the database cannot give you the link back — the log is the way to see it.)

If you would rather see real mail, run a throwaway SMTP catcher and point the API at it:

```powershell
python -m aiosmtpd -n -l localhost:1025    # prints every message it receives
```

```powershell
$env:EMAIL_PROVIDER="smtp"; $env:SMTP_HOST="localhost"; $env:SMTP_PORT="1025"
$env:SMTP_FROM="no-reply@trainhub360.local"; $env:APP_BASE_URL="http://localhost:5173"
pnpm --filter @workspace/api run dev
```

The link in the mail is `http://localhost:5173/activate?token=…`. Open it:

- Password + confirm → "Account activated".
- Mismatched passwords → inline error, no request sent.
- A token you already used, or a garbled one → `invalid or expired activation token`.
- `/activate` with no `?token=` → "This link is incomplete".

### 3c. Confirm the SMTP failure mode

The `[CONFIRM]` decision: a deployment that says `smtp` must not silently fall back to
logging. Check it:

```powershell
$env:EMAIL_PROVIDER="smtp"; Remove-Item Env:\SMTP_HOST -ErrorAction SilentlyContinue
```

Add a learner. The account is still created (the API answers 201 with `emailSent: false`),
the send is **not** quietly logged, and the failure is recorded — check it:

```powershell
sqlcmd -S localhost -U trainhub_test -P <password> -d TrainHub360_Test -C -Q "SELECT TOP 5 [to], kind, error, created_at FROM email_failures ORDER BY created_at DESC"
```

Terminal 1 also prints `[email] send failed to=… kind=activation: EMAIL_PROVIDER=smtp but
SMTP_HOST is not set`, and **People** shows the person as *invited* with a **Resend invite**
button. Clear `$env:EMAIL_PROVIDER` to go back to the console sender.

### 3d. The password-reset link (gap 4)

1. Sign out, click **Forgot password?**, enter an existing address, send.
2. Copy the `…/reset-password?token=…` link out of Terminal 1 (same block as above) and open
   it in a fresh tab — it must render the reset page, not the login screen.
3. Choose a password twice → "Password updated", then sign in with it.
4. Reuse the same link → `invalid or expired token`. Open `/reset-password` with no token →
   "This link is incomplete".

### 3e. The login throttle (gap 8)

```powershell
$env:LOGIN_THROTTLE_ACCOUNT_LIMIT="3"
pnpm --filter @workspace/api run dev
```

Sign in with the wrong password three times, then with the right one: the right one is
refused too, with the same `invalid credentials` message. Restart the API (or wait out
`LOGIN_THROTTLE_WINDOW_MS`) and the correct password works again. Remove the variable
afterwards.

---

## 4. What to send me if something fails

For the API: the whole `pnpm --filter @workspace/api run test` tail (the `ℹ` summary lines).
For the frontend: the failing test name and the `→` reason line. For the browser: which
page, what you clicked, and what Terminal 1 printed.
