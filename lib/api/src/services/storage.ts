import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

// Pluggable object storage. Local disk is the dev/default implementation;
// STORAGE_PROVIDER=s3|azure is reserved for the cloud implementation (not built).
// Decision recorded 2026-11-19: local disk behind this interface for now.
export interface StoredObject {
  key: string;
  sizeBytes: number;
  checksum: string;
}

export interface StorageProvider {
  put(key: string, data: Buffer): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

function rootDir(): string {
  return process.env.STORAGE_DIR ?? path.join(process.cwd(), ".storage");
}

function safePath(key: string): string {
  if (!/^[a-zA-Z0-9/_-]+\.[a-zA-Z0-9]+$/.test(key) || key.includes("..")) {
    throw Object.assign(new Error("invalid storage key"), { status: 400 });
  }
  return path.join(rootDir(), key);
}

export function newStorageKey(extension: string): string {
  const ext = extension.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) || "bin";
  const stamp = new Date().toISOString().slice(0, 10);
  return `content/${stamp}/${crypto.randomBytes(16).toString("hex")}.${ext}`;
}

export const localStorage: StorageProvider = {
  async put(key, data) {
    const file = safePath(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, data);
    return { key, sizeBytes: data.length, checksum: crypto.createHash("sha256").update(data).digest("hex") };
  },
  async get(key) {
    return fs.readFile(safePath(key));
  },
  async delete(key) {
    await fs.rm(safePath(key), { force: true });
  },
};

let override: StorageProvider | null = null;
export function setStorageProvider(provider: StorageProvider | null) {
  override = provider;
}
export function getStorageProvider(): StorageProvider {
  return override ?? localStorage;
}

// Virus-scanning hook. No-op today; replace with a real scanner in production.
export async function scanUpload(_file: { key: string; mimeType: string; sizeBytes: number }): Promise<{ ok: boolean; reason?: string }> {
  return { ok: true };
}
