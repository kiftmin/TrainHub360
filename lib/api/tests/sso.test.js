import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env") });

process.env.SSO_ENABLED = "true";

const UNSIGNED_RESPONSE = Buffer.from(
  `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="_x" Version="2.0" IssueInstant="2026-09-12T00:00:00Z"><saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">https://idp.example.com</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status><saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_a" IssueInstant="2026-09-12T00:00:00Z" Version="2.0"><saml:Issuer>https://idp.example.com</saml:Issuer><saml:Subject><saml:NameID>victim@example.com</saml:NameID></saml:Subject></saml:Assertion></samlp:Response>`,
).toString("base64");

describe("POST /auth/sso", () => {
  let app;
  let server;
  let baseUrl = "";
  let prisma;
  const stamp = Date.now();
  const orgId = `sso-org-${stamp}`;

  before(async () => {
    if (!process.env.DATABASE_URL) return;
    process.env.NODE_ENV = "test";
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
    const selfsigned = (await import("selfsigned")).default;
    const pems = selfsigned.generate([{ name: "commonName", value: "idp.test" }], { days: 2 });
    await prisma.organization.create({
      data: { id: orgId, name: "SSO Org", samlEnabled: true, samlIdpCert: pems.cert, samlIdpIssuer: "https://idp.example.com", samlEntityId: "trainhub360-test" },
    });
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (prisma) {
      await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => null);
      await prisma.$disconnect();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  const sso = (body) =>
    fetch(`${baseUrl}/api/auth/sso`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  test("garbage assertion is rejected with 401", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await sso({ samlAssertion: "not-a-real-assertion!!!", orgId });
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: "invalid credentials" });
  });

  test("unsigned well-formed XML is rejected with 401", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await sso({ samlAssertion: UNSIGNED_RESPONSE, orgId });
    assert.equal(res.status, 401);
  });

  test("unknown org is rejected with 401, not 500", async (t) => {
    if (!server) return t.skip("database unreachable");
    const res = await sso({ samlAssertion: UNSIGNED_RESPONSE, orgId: "no-such-org" });
    assert.equal(res.status, 401);
  });
});
