# A.3 — Uploads, `StoredFile`, and org-bound file ids

Closes **H4** and **M5** from `trainhub360-review-round6.md`. Everything else in the review is
tracked separately below.

## What was wrong

**H4 — no real uploads.** The only upload route took `{fileName, mimeType, dataBase64}` in a
JSON body, and `express.json()` caps a JSON body at **100 KB**. Any real PDF, deck, video or zip
was refused with `413` before the route ran, so the "50 MB limit" was never reachable and the
feature did not work for its stated purpose. There was no `multipart/form-data` support and no
`multer` (or equivalent) in the API at all.

**M5 — file ids were not bound to anything.** A content item accepted a `storageKey` string
straight from the request body, and a progress record accepted an `evidenceFileKey`. Nothing
checked that the key had ever been uploaded, or that it belonged to the caller's organization.
A made-up key was stored as if it were a file, and a key copied from another tenant was
accepted. The same value was also re-posted from the browser into the item body, so the file's
name, MIME type, size and checksum came from the client rather than from the stored bytes.

## What changed

### Schema (`lib/db/prisma/schema.prisma`)

New `StoredFile` model — `orgId`, `uploadedById`, `storageKey` (unique), `fileName`, `mimeType`,
`sizeBytes`, `checksum`, `purpose` (`content` | `evidence`), `createdAt`. It is now the only
thing a file may point at:

- `ContentItem.storedFileId` → `StoredFile` (null for rows created before A.3).
- `ContentProgress.evidenceFileId` → `StoredFile` (null for rows created before A.3).

Pushed with `prisma db push`; the existing `storageKey` / `evidenceFileKey` columns are kept so
old rows still download.

### API

- **`lib/api/src/services/uploads.ts`** (new) — the allowlist (extension + MIME), the size cap
  (`UPLOAD_MAX_BYTES`, default 50 MB), `storeUpload()` (validates, writes through the
  `StorageProvider`, runs `scanUpload`, records the `StoredFile`), `resolveUploadedFile()`
  (an id or key is only accepted if it belongs to the caller's organization), and the multer
  middleware (disk storage in `STORAGE_DIR/.incoming`, one part named `file`, hard size cap).
- **`POST /api/modules/:moduleId/content/upload`** — now `multipart/form-data`, staff only. The
  module is checked against the caller's organization first. The legacy JSON body is still
  accepted (small files only) and goes through exactly the same `storeUpload()`.
  Returns `storedFileId` alongside `storageKey`, `fileName`, `mimeType`, `sizeBytes`,
  `checksum`, `purpose`.
- **`POST /api/uploads/evidence`** (new) — any member of the organization; a learner's proof
  for a trainer-verified item. Stores a `StoredFile` with `purpose = "evidence"`.
- **`POST /api/modules/:moduleId/content`** — a `file` item resolves `storedFileId` (or a
  legacy `storageKey`) to a `StoredFile` **of the same organization**; name, MIME, size and
  checksum are copied from that row, never from the request. A key that was never uploaded is
  a `400`; another organization's file is a `404`.
- **`PATCH /api/content/:id`** — can repoint a file item at a newly uploaded `StoredFile`, with
  the same org check.
- **`POST /api/content/:id/progress`** — accepts `evidenceFileId` (the old `evidenceFileKey`
  still works but must resolve to a `StoredFile` of the same organization). Only an upload with
  `purpose = "evidence"` is accepted as learner proof, so a staff content upload cannot be
  passed off as evidence.
- **`GET /api/content-progress/:id/evidence`** (new) — the learner who uploaded it, or programme
  staff of that programme, and only within the organization. `POST …/verify` now also returns
  the file (`evidenceFile`) so the verifier sees which document they are approving.
- Every upload writes a `FILE_UPLOADED` audit entry.

### Frontend

- **`api/client.ts`** — a `FormData` body no longer gets `content-type: application/json`
  (which made multipart requests unparseable); the browser sets its own boundary.
- **`api/hooks.ts`** — `useUploadContent` posts `FormData` instead of base64; new
  `useUploadEvidence`; `useContentProgress` sends `evidenceFileId`. `UploadedFile` is the
  response type. The 100 KB `FileReader` base64 path is gone.
- **`pages/Programmes.tsx`** — a file item is created with `storedFileId`.
- **`pages/MyLearning.tsx`** — a trainer-verified item now has a file picker next to the note,
  so a learner can attach proof rather than only type it.

### Dependencies

`multer` + `@types/multer` in `lib/api`. `@types/multer` declares `@types/express: "*"`, which
resolved to the **Express 5** typings while the API runs Express 4, so every
`router.post(path, uploadSingleFile, handler)` failed to typecheck (two incompatible copies of
`RequestHandler`). `pnpm-workspace.yaml` now overrides `@types/express` to `4.17.25`.

## Tests

`lib/api/tests/a3-uploads.test.js` (6 cases, real SQL Server, temp `STORAGE_DIR`):

1. a 200 KB PDF uploads over multipart, is stored byte for byte, and the `StoredFile` row
   carries the organization, uploader and a sha256 checksum;
2. the same file as a JSON body is still `413` — the reason multipart exists;
3. disallowed extension, wrong MIME, oversized file (`413`) and empty file are refused;
4. a file item refuses another organization's `StoredFile` (`404`) and an invented key (`400`),
   and takes name/MIME/size/checksum from the upload when it succeeds;
5. the learner download serves the same bytes afterwards;
6. learner evidence: an invented key is refused, a learner cannot upload into the content
   library (`403`) but can through `/uploads/evidence`, a staff content upload is refused as
   proof, programme staff can download the evidence, another organization gets `404`, and
   verification returns the file it approved.

`frontend/src/a3-uploads.test.tsx` (3 cases): `useUploadContent` and `useUploadEvidence` send
`FormData` with no JSON content type, and an ordinary JSON request still sends it.

## Results

| Check | Before | After |
| --- | --- | --- |
| API suite (real SQL Server) | 120 pass | **126 pass / 0 fail / 0 skipped** |
| Frontend suite | 30 pass | **33 pass / 0 fail** (5 files) |
| `pnpm --filter @workspace/api run build` | clean | clean |
| `frontend` `pnpm run typecheck` | clean | clean |
| `prisma db push` | in sync | in sync |

## Not started (unchanged)

- **A.3 remainder:** an S3/Azure `StorageProvider` (still local disk), a real `scanUpload`
  (still a no-op), and serving content files from a CDN instead of the API process.
- **Phase B:** trainer-by-id, cross-tenant rename, thread access, RSVP, join-link visibility.
- **Phase C:** assessment → certificate → review-credit loop.
- **Phase D:** reminder cadence and `.ics`.
- **Phase E:** content integrity and verification UI.

## Trying it

```sh
# staff upload (multipart)
curl -H "authorization: Bearer $TOKEN" -F "file=@handbook.pdf;type=application/pdf" \
  http://localhost:4000/api/modules/<moduleId>/content/upload
# → {"storedFileId":"…","fileName":"handbook.pdf","mimeType":"application/pdf",…}

# attach it to an item
curl -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"type":"file","title":"Handbook","storedFileId":"…"}' \
  http://localhost:4000/api/modules/<moduleId>/content
```
