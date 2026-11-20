// Round 6 / A.3: multipart uploads, a StoredFile record, and org-bound file ids.
//
// What this fixes (trainhub360-review-round6.md H4 and M5):
//   - Uploads were base64 inside a JSON body, and `express.json()` caps a JSON body at 100 KB,
//     so almost any real PDF or video was rejected with 413 before the route ran. There is now
//     a real multipart route (`multipart/form-data`, one `file` part) that streams to disk with
//     multer's disk storage, so the 50 MB limit is the only limit.
//   - A content item and a progress record accepted a `storageKey` straight from the request
//     body, with nothing tying it to an organization or to an actual upload. Every upload now
//     creates a StoredFile row (org, uploader, name, mime, size, checksum), and a content item
//     or an evidence attachment may only reference a StoredFile of the caller's organization.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import multer from "multer";
import { db } from "../db.js";
import { getStorageProvider, newStorageKey, scanUpload } from "./storage.js";

/** Extension/MIME allowlist shared by the multipart route and the legacy JSON route. */
export const UPLOAD_MIME = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/png", "image/jpeg", "image/gif", "image/webp",
  "video/mp4", "video/webm", "application/zip",
]);
export const UPLOAD_EXT = new Set(["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "png", "jpg", "jpeg", "gif", "webp", "mp4", "webm", "zip"]);

export function uploadMaxBytes(): number {
  const configured = Number(process.env.UPLOAD_MAX_BYTES ?? 50 * 1024 * 1024);
  return Number.isFinite(configured) && configured > 0 ? configured : 50 * 1024 * 1024;
}

/** A sanitized display name. Never used as a filesystem path. */
export function safeFileName(name: string): string {
  return String(name ?? "").replace(/[\\/:*?"<>|]/g, "_").trim().slice(0, 200) || "upload";
}

export function extensionOf(fileName: string): string {
  const ext = (String(fileName).split(".").pop() ?? "").toLowerCase();
  return /^[a-z0-9]{1,10}$/.test(ext) ? ext : "";
}

export class UploadRejected extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Validates an uploaded file against the allowlist and the size cap, then stores it through
 * the StorageProvider and records the StoredFile row. Throws UploadRejected with the status
 * the route should answer.
 */
export async function storeUpload(input: {
  orgId: string;
  userId: string | null;
  purpose: "content" | "evidence";
  fileName: string;
  mimeType: string;
  data: Buffer;
}) {
  const fileName = safeFileName(input.fileName);
  const mimeType = String(input.mimeType ?? "").trim().toLowerCase();
  const ext = extensionOf(fileName);
  if (!ext) throw new UploadRejected("the file name needs an extension");
  if (!UPLOAD_EXT.has(ext)) throw new UploadRejected(`file extension .${ext} is not allowed`);
  if (!UPLOAD_MIME.has(mimeType)) throw new UploadRejected(`mime type ${mimeType || "(none)"} is not allowed`);
  if (!input.data?.length) throw new UploadRejected("empty file");
  const maxBytes = uploadMaxBytes();
  if (input.data.length > maxBytes) {
    throw new UploadRejected(`file exceeds the ${Math.round(maxBytes / (1024 * 1024))}MB limit`, 413);
  }
  const key = newStorageKey(ext);
  const stored = await getStorageProvider().put(key, input.data);
  const scan = await scanUpload({ key, mimeType, sizeBytes: stored.sizeBytes });
  if (!scan.ok) {
    await getStorageProvider().delete(key).catch(() => null);
    throw new UploadRejected(scan.reason ?? "upload rejected by scanner", 422);
  }
  return db.storedFile.create({
    data: {
      orgId: input.orgId,
      uploadedById: input.userId,
      storageKey: stored.key,
      fileName,
      mimeType,
      sizeBytes: stored.sizeBytes,
      checksum: stored.checksum,
      purpose: input.purpose,
    },
  });
}

/**
 * Resolves the file a content item should point at. `storedFileId` is the A.3 contract; a
 * bare `storageKey` is still accepted for the legacy JSON upload response, but only when it
 * belongs to a StoredFile of the caller's organization.
 */
export async function resolveUploadedFile(orgId: string, body: { storedFileId?: unknown; storageKey?: unknown }) {
  if (body?.storedFileId) {
    const file = await db.storedFile.findFirst({ where: { id: String(body.storedFileId), orgId } }).catch(() => null);
    if (!file) throw new UploadRejected("stored file not found in your organization", 404);
    return file;
  }
  if (body?.storageKey) {
    const file = await db.storedFile.findFirst({ where: { storageKey: String(body.storageKey), orgId } }).catch(() => null);
    if (!file) throw new UploadRejected("that storage key was not uploaded in your organization — upload the file first", 400);
    return file;
  }
  return null;
}

/** multer on disk: the file lands in a temp directory, then storeUpload() copies it in. */
const tmpDir = () => path.join(process.env.STORAGE_DIR ?? path.join(process.cwd(), ".storage"), ".incoming");

/**
 * The multipart middleware. One file part, field name `file`. The size cap is enforced here
 * (so an oversized body is refused before it is fully read) and again in storeUpload().
 */
export const uploadSingleFile = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, cb) => {
      const dir = tmpDir();
      try {
        await fs.mkdir(dir, { recursive: true });
        cb(null, dir);
      } catch (e) {
        cb(e as Error, dir);
      }
    },
    filename: (_req, _file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.part`),
  }),
  limits: { fileSize: uploadMaxBytes(), files: 1 },
}).single("file");

/** Reads a multer temp file and removes it, whatever happens next. */
export async function consumeTempFile(file: Express.Multer.File): Promise<Buffer> {
  try {
    return await fs.readFile(file.path);
  } finally {
    await fs.rm(file.path, { force: true }).catch(() => null);
  }
}
