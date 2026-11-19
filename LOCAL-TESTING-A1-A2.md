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

**Expect:** `tests 106`, `pass 106`, `fail 0`, `skipped 0`, about 40 s.

- `skipped` **must be 0**. If you see skips, `DATABASE_URL` was not read — check the `.env`
  location (repo root, not `lib/api`).
- `[email] to=… subject=…` lines in the output are the console sender working, which is the
  expected default. That is what A.2 replaced with a real one.
- `[api] unhandled error: TypeError: kaboom` is the 500 test throwing on purpose.

To prove CI's rule works, run once with the database switched off — it must **fail loudly**
instead of skipping:

```powershell
$env:CI="true"; $env:DATABASE_URL=""
pnpm --filter @workspace/api run test
$env:CI=""; Remove-Item Env:\DATABASE_URL
```

You should get `DATABASE_URL is not set. CI must run the API suite against a real SQL Server`.

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

**Expect:** typecheck silent, then `Test Files 3 passed`, `Tests 23 passed`.

Two gotchas:
- Without `--ignore-workspace` pnpm walks up and installs the backend instead.
- The tests need **Node 22+** (jsdom 30 needs it). On Node 20 you get
  `webidl.util.markAsUncloneable is not a function`. `node -v` to check.

The 7 new cases are in `frontend/src/a2-notifications.test.tsx` — activation page (no token,
success, mismatched passwords, expired token) and the bell (list, badge, click-through marks
read, empty state).

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

The badge only appears **after the panel has been opened once** — the count comes from the
same request as the list, and the panel only fetches when open. That is deliberate: an idle
workspace makes no polling requests.

### 3b. The activation page

This is the one the old code got wrong (links were sent as bare `/activate?token=…`).

1. As an org admin, add a learner in **People** with an email you can read.
2. Watch Terminal 1 — you will see
   `[email] to=… subject="Activate your TrainHub360 account"`.
3. The console sender does not print the body, so read the token from the database:

```powershell
# with sqlcmd, or any SQL client
sqlcmd -S localhost -U trainhub_test -P <password> -d TrainHub360_Test -C -Q "SELECT TOP 1 tokenHash FROM password_reset_tokens ORDER BY created_at DESC"
```

The stored value is a **hash**, so it cannot be turned back into the link. The reliable way to
see the real URL is to install a fake SMTP catcher and read the message:

```powershell
python -m smtpd -n -c DebuggingServer localhost:1025    # prints every message to the console
```

then run the API with:

```powershell
$env:EMAIL_PROVIDER="smtp"; $env:SMTP_HOST="localhost"; $env:SMTP_PORT="1025"
$env:SMTP_FROM="no-reply@trainhub360.local"; $env:APP_BASE_URL="http://localhost:5173"
pnpm --filter @workspace/api run dev
```

Add a learner again — the full email now prints in Terminal 1, and the link in it is
`http://localhost:5173/activate?token=…`. Open it:

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

Trigger any email (add a learner). The request should **error** with
`EMAIL_PROVIDER=smtp but SMTP_HOST is not set`, not quietly log. That is the intended
behaviour — clear `$env:EMAIL_PROVIDER` to go back to the console sender.

---

## 4. What to send me if something fails

For the API: the whole `pnpm --filter @workspace/api run test` tail (the `ℹ` summary lines).
For the frontend: the failing test name and the `→` reason line. For the browser: which
page, what you clicked, and what Terminal 1 printed.
