// Round 6 / A.3 — multipart uploads, StoredFile, and org-bound file ids.
//
//   H4: a real PDF or video is refused with 413 because the upload was base64 inside JSON and
//       express.json() caps a JSON body at 100 KB. Fixed by a multipart route.
//   M5: a content item accepted any `storageKey` string from the request body — an id from
//       another organization, or a key that was never uploaded. Fixed by StoredFile.
//
// Every test here fails if the corresponding fix is reverted.
import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { hashPassword } from "../dist/services/password.js";
import { signToken } from "../dist/middleware/auth.js";
import { requireDatabase } from "./support/requireDatabase.js";
import { seedRoles } from "./support/seedRoles.js";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env") });

const stamp = Date.now();
let app;
let server;
let baseUrl;
let prisma;
let storageDir;

const ids = {
  org: `a3-org-${stamp}`,
  otherOrg: `a3-org-other-${stamp}`,
  admin: `a3-admin-${stamp}@example.com`,
  outsider: `a3-outsider-${stamp}@example.com`,
  learner: `a3-learner-${stamp}@example.com`,
};
const extra = {};

async function api(pathname, { method = "GET", token, body, form, headers = {} } = {}) {
  const init = { method, headers: { ...headers } };
  if (token) init.headers.authorization = `Bearer ${token}`;
  if (form) {
    init.body = form;
  } else if (body !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${baseUrl}${pathname}`, init);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, json, text, headers: res.headers };
}

/** A buffer that is not valid UTF-8, so "stored byte for byte" is a real claim. */
function pdfLike(bytes = 200 * 1024) {
  const head = Buffer.from("%PDF-1.7\n");
  const body = Buffer.alloc(Math.max(0, bytes - head.length), 0x25);
  for (let i = 0; i < body.length; i++) body[i] = (i * 37 + 11) % 256;
  return Buffer.concat([head, body]);
}

function fileForm(data, name, type) {
  const form = new FormData();
  form.append("file", new Blob([data], { type }), name);
  return form;
}

describe("A.3 — multipart uploads, StoredFile and org-bound file ids", () => {
  before(async () => {
    if (!requireDatabase("a3-uploads.test.js")) return;
    process.env.NODE_ENV = "test";
    storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "a3-storage-"));
    process.env.STORAGE_DIR = storageDir;
    ({ default: app } = await import("../dist/index.js"));
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      await prisma.$disconnect();
      prisma = null;
      return;
    }
    await seedRoles(prisma, ["owner", "admin", "trainer", "learner", "stakeholder"]);
    const pw = await hashPassword("pw-a3");
    await prisma.organization.createMany({ data: [{ id: ids.org, name: "A3 Org" }, { id: ids.otherOrg, name: "A3 Other Org" }] });
    const admin = await prisma.user.create({ data: { orgId: ids.org, name: "A3 Admin", email: ids.admin, passwordHash: pw } });
    const outsider = await prisma.user.create({ data: { orgId: ids.otherOrg, name: "A3 Outsider", email: ids.outsider, passwordHash: pw } });
    const learner = await prisma.user.create({ data: { orgId: ids.org, name: "A3 Learner", email: ids.learner, passwordHash: pw } });
    await prisma.userRole.create({ data: { userId: admin.id, roleId: "admin", programmeId: null } });
    await prisma.userRole.create({ data: { userId: outsider.id, roleId: "admin", programmeId: null } });
    await prisma.userRole.create({ data: { userId: learner.id, roleId: "learner", programmeId: null } });
    const programme = await prisma.programme.create({
      data: { id: `a3-prog-${stamp}`, orgId: ids.org, name: "A3 Programme", type: "Test", owner: "A3 Admin" },
    });
    const course = await prisma.course.create({ data: { id: `a3-course-${stamp}`, programmeId: programme.id, title: "A3 Course" } });
    const mod = await prisma.module.create({ data: { id: `a3-mod-${stamp}`, courseId: course.id, title: "A3 Module" } });
    await prisma.enrolment.create({ data: { id: `a3-enr-${stamp}`, learnerId: learner.id, courseId: course.id, programmeId: programme.id, status: "active" } });
    extra.programmeId = programme.id;
    extra.courseId = course.id;
    extra.moduleId = mod.id;
    extra.adminToken = signToken({ id: admin.id, role: "admin", orgId: ids.org, tokenVersion: 0 });
    extra.outsiderToken = signToken({ id: outsider.id, role: "admin", orgId: ids.otherOrg, tokenVersion: 0 });
    extra.learnerToken = signToken({ id: learner.id, role: "learner", orgId: ids.org, tokenVersion: 0 });
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (prisma) {
      await prisma.contentProgress.deleteMany({ where: { contentItem: { orgId: ids.org } } }).catch(() => null);
      await prisma.contentItem.deleteMany({ where: { orgId: ids.org } }).catch(() => null);
      await prisma.storedFile.deleteMany({ where: { orgId: { in: [ids.org, ids.otherOrg] } } }).catch(() => null);
      await prisma.enrolment.deleteMany({ where: { id: `a3-enr-${stamp}` } }).catch(() => null);
      await prisma.module.deleteMany({ where: { id: extra.moduleId } }).catch(() => null);
      await prisma.course.deleteMany({ where: { id: extra.courseId } }).catch(() => null);
      await prisma.programme.deleteMany({ where: { id: extra.programmeId } }).catch(() => null);
      await prisma.userRole.deleteMany({ where: { userId: { in: [extra.adminId, extra.learnerId, extra.outsiderId].filter(Boolean) } } }).catch(() => null);
      await prisma.user.deleteMany({ where: { email: { in: [ids.admin, ids.outsider, ids.learner] } } }).catch(() => null);
      await prisma.organization.deleteMany({ where: { id: { in: [ids.org, ids.otherOrg] } } }).catch(() => null);
      await prisma.$disconnect();
    }
    if (storageDir) await fs.rm(storageDir, { recursive: true, force: true }).catch(() => null);
  });

  test("a 200 KB PDF uploads over multipart (it was refused with 413 as a JSON body)", async (t) => {
    if (!server) return t.skip("database unreachable");
    const data = pdfLike();
    const res = await api(`/api/modules/${extra.moduleId}/content/upload`, {
      method: "POST",
      token: extra.adminToken,
      form: fileForm(data, "handbook.pdf", "application/pdf"),
    });
    assert.equal(res.status, 201, res.text);
    assert.ok(res.json.storedFileId, "the response carries the StoredFile id");
    assert.equal(res.json.fileName, "handbook.pdf");
    assert.equal(res.json.mimeType, "application/pdf");
    assert.equal(res.json.sizeBytes, data.length);
    assert.match(res.json.checksum, /^[0-9a-f]{64}$/);
    extra.pdfUpload = res.json;

    const row = await prisma.storedFile.findUnique({ where: { id: res.json.storedFileId } });
    assert.equal(row.orgId, ids.org, "the upload is bound to the caller's organization");
    assert.equal(row.purpose, "content");
    assert.ok(row.uploadedById, "the uploader is recorded");
    const onDisk = await fs.readFile(path.join(storageDir, row.storageKey));
    assert.deepEqual(onDisk, data, "stored byte for byte");
  });

  test("the same upload as a JSON body is still refused with 413 (the limit is the body parser)", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await api(`/api/modules/${extra.moduleId}/content/upload`, {
      method: "POST",
      token: extra.adminToken,
      body: { fileName: "big.pdf", mimeType: "application/pdf", dataBase64: pdfLike().toString("base64") },
    });
    assert.equal(res.status, 413, "express.json() still caps a JSON body — this is why multipart exists");
  });

  test("the multipart route refuses a disallowed type, an oversized file and an empty file", async (t) => {
    if (!server) return t.skip("database unreachable");
    const exe = await api(`/api/modules/${extra.moduleId}/content/upload`, {
      method: "POST", token: extra.adminToken, form: fileForm(Buffer.from("MZ"), "setup.exe", "application/x-msdownload"),
    });
    assert.equal(exe.status, 400, exe.text);
    assert.match(exe.json.error, /not allowed/);

    const wrongMime = await api(`/api/modules/${extra.moduleId}/content/upload`, {
      method: "POST", token: extra.adminToken, form: fileForm(Buffer.from("hello"), "notes.pdf", "text/plain"),
    });
    assert.equal(wrongMime.status, 400);
    assert.match(wrongMime.json.error, /mime type/);

    const previous = process.env.UPLOAD_MAX_BYTES;
    process.env.UPLOAD_MAX_BYTES = String(1024 * 1024);
    try {
      const tooBig = await api(`/api/modules/${extra.moduleId}/content/upload`, {
        method: "POST", token: extra.adminToken, form: fileForm(pdfLike(2 * 1024 * 1024), "huge.pdf", "application/pdf"),
      });
      assert.equal(tooBig.status, 413, tooBig.text);
    } finally {
      if (previous === undefined) delete process.env.UPLOAD_MAX_BYTES;
      else process.env.UPLOAD_MAX_BYTES = previous;
    }

    const empty = await api(`/api/modules/${extra.moduleId}/content/upload`, {
      method: "POST", token: extra.adminToken, form: fileForm(Buffer.alloc(0), "empty.pdf", "application/pdf"),
    });
    assert.equal(empty.status, 400, empty.text);
  });

  test("a content item can only point at an upload of its own organization", async (t) => {
    if (!server) return t.skip("database unreachable");
    // Another organization uploads its own file.
    const foreign = await api(`/api/modules/${extra.moduleId}/content/upload`, {
      method: "POST", token: extra.outsiderToken, form: fileForm(pdfLike(1024), "foreign.pdf", "application/pdf"),
    });
    assert.equal(foreign.status, 404, "an outsider cannot upload into another organization's module");

    // Create a file item in the other org by hand, then try to reference it from this org.
    const foreignModule = await prisma.module.create({ data: { courseId: extra.courseId, title: "A3 Foreign Module" } }).catch(() => null);
    const foreignFile = await prisma.storedFile.create({
      data: {
        orgId: ids.otherOrg, storageKey: `content/foreign/${stamp}.pdf`, fileName: "theirs.pdf",
        mimeType: "application/pdf", sizeBytes: 10, checksum: "0".repeat(64), purpose: "content",
      },
    });

    const crossOrg = await api(`/api/modules/${extra.moduleId}/content`, {
      method: "POST", token: extra.adminToken,
      body: { type: "file", title: "Stolen", storedFileId: foreignFile.id },
    });
    assert.equal(crossOrg.status, 404, crossOrg.text);
    assert.match(crossOrg.json.error, /not found in your organization/);

    const madeUpKey = await api(`/api/modules/${extra.moduleId}/content`, {
      method: "POST", token: extra.adminToken,
      body: { type: "file", title: "Invented", storageKey: "content/2026-01-01/deadbeef.pdf", fileName: "x.pdf", mimeType: "application/pdf" },
    });
    assert.equal(madeUpKey.status, 400, madeUpKey.text);
    assert.match(madeUpKey.json.error, /upload the file first/);

    const good = await api(`/api/modules/${extra.moduleId}/content`, {
      method: "POST", token: extra.adminToken,
      body: { type: "file", title: "Handbook", storedFileId: extra.pdfUpload.storedFileId },
    });
    assert.equal(good.status, 201, good.text);
    assert.equal(good.json.storedFileId, extra.pdfUpload.storedFileId);
    assert.equal(good.json.fileName, "handbook.pdf", "name, mime, size and checksum come from the upload, not the body");
    assert.equal(good.json.checksum, extra.pdfUpload.checksum);
    extra.fileItemId = good.json.id;

    if (foreignModule) await prisma.module.delete({ where: { id: foreignModule.id } }).catch(() => null);
    await prisma.storedFile.delete({ where: { id: foreignFile.id } }).catch(() => null);
  });

  test("the learner download still serves the file after the upload", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await fetch(`${baseUrl}/api/content/${extra.fileItemId}/download`, {
      headers: { authorization: `Bearer ${extra.learnerToken}` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/pdf");
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.equal(bytes.length, extra.pdfUpload.sizeBytes);
    assert.deepEqual(bytes, pdfLike());
  });

  test("learner evidence must be an upload of the same organization, and staff can download it", async (t) => {
    if (!server) return t.skip("database unreachable");
    const link = await prisma.contentItem.create({
      data: {
        orgId: ids.org, moduleId: extra.moduleId, type: "external_link", title: "Case study",
        url: "https://example.com/case-study", provider: "generic", completionMode: "trainer_verified",
      },
    });
    const invented = await api(`/api/content/${link.id}/progress`, {
      method: "POST", token: extra.learnerToken,
      body: { status: "completed", evidenceFileKey: "content/2026-01-01/nothing-here.pdf" },
    });
    assert.equal(invented.status, 400, invented.text);
    assert.match(invented.json.error, /was not uploaded in your organization/);

    // A learner cannot upload into the module's content library (staff only)…
    const asContent = await api(`/api/modules/${extra.moduleId}/content/upload`, {
      method: "POST", token: extra.learnerToken, form: fileForm(Buffer.from("%PDF-1.4 evidence"), "evidence.pdf", "application/pdf"),
    });
    assert.equal(asContent.status, 403, asContent.text);

    // …but they can attach proof through the evidence upload.
    const evidence = await api("/api/uploads/evidence", {
      method: "POST", token: extra.learnerToken, form: fileForm(Buffer.from("%PDF-1.4 evidence"), "evidence.pdf", "application/pdf"),
    });
    assert.equal(evidence.status, 201, evidence.text);
    assert.equal(evidence.json.purpose, "evidence");

    // A content upload (staff-only) is not acceptable as learner proof.
    const contentAsProof = await api(`/api/content/${link.id}/progress`, {
      method: "POST", token: extra.learnerToken, body: { status: "completed", evidenceFileId: extra.pdfUpload.storedFileId },
    });
    assert.equal(contentAsProof.status, 400, contentAsProof.text);
    assert.match(contentAsProof.json.error, /uploads\/evidence/);

    const submitted = await api(`/api/content/${link.id}/progress`, {
      method: "POST", token: extra.learnerToken,
      body: { status: "completed", evidenceFileId: evidence.json.storedFileId },
    });
    assert.equal(submitted.status, 200, submitted.text);
    assert.equal(submitted.json.status, "pending_verification");
    assert.equal(submitted.json.evidenceFileId, evidence.json.storedFileId);

    const download = await fetch(`${baseUrl}/api/content-progress/${submitted.json.id}/evidence`, {
      headers: { authorization: `Bearer ${extra.adminToken}` },
    });
    assert.equal(download.status, 200, "programme staff can open the evidence");
    assert.match(await download.text(), /evidence/);

    const asOutsider = await fetch(`${baseUrl}/api/content-progress/${submitted.json.id}/evidence`, {
      headers: { authorization: `Bearer ${extra.outsiderToken}` },
    });
    assert.equal(asOutsider.status, 404, "another organization cannot reach the evidence at all");

    const verify = await api(`/api/content-progress/${submitted.json.id}/verify`, {
      method: "POST", token: extra.adminToken, body: { verified: true },
    });
    assert.equal(verify.status, 200, verify.text);
    assert.equal(verify.json.evidenceFile.fileName, "evidence.pdf", "the verifier sees which file it is approving");
  });
});
