import { SAML, ValidateInResponseTo } from "@node-saml/node-saml";
import { db } from "../db.js";

export interface ValidatedSamlUser {
  email: string;
  nameID: string;
  attributes: Record<string, unknown>;
}

function extractEmail(profile: Record<string, unknown>): string | null {
  const attrs = (profile.attributes ?? {}) as Record<string, unknown>;
  const candidates = [profile.email, attrs.email, (attrs as Record<string, unknown>)["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"], profile.nameID];
  for (const c of candidates) {
    if (typeof c === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c)) return c;
  }
  return null;
}

export async function validateSamlResponse(
  samlResponseB64: string,
  config: { idpCert: string; spEntityId: string; audience: string; idpIssuer?: string | null },
): Promise<ValidatedSamlUser> {
  const saml = new SAML({
    callbackUrl: "http://localhost:4000/api/auth/sso",
    issuer: config.spEntityId,
    audience: config.audience,
    idpCert: config.idpCert,
    ...(config.idpIssuer ? { idpIssuer: config.idpIssuer } : {}),
    validateInResponseTo: ValidateInResponseTo.never,
    acceptedClockSkewMs: 120000,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
  });
  const { profile } = await saml.validatePostResponseAsync({ SAMLResponse: samlResponseB64 });
  const record = profile as unknown as Record<string, unknown>;
  const email = extractEmail(record);
  if (!email) throw new Error("SAML response contains no usable email");
  return { email, nameID: String(record.nameID ?? email), attributes: (record.attributes ?? {}) as Record<string, unknown> };
}

export async function loginWithSaml(orgId: string, samlResponseB64: string): Promise<{ userId: string; email: string; name: string } | null> {
  const org = await db.organization.findUnique({ where: { id: orgId } }).catch(() => null);
  if (!org || !org.samlEnabled || !org.samlIdpCert) return null;
  let validated: ValidatedSamlUser;
  try {
    validated = await validateSamlResponse(samlResponseB64, {
      idpCert: org.samlIdpCert,
      spEntityId: org.samlEntityId ?? "trainhub360",
      audience: org.samlEntityId ?? "trainhub360",
      idpIssuer: org.samlIdpIssuer,
    });
  } catch {
    return null;
  }
  const user = await db.user.findFirst({ where: { email: validated.email, orgId } }).catch(() => null);
  if (!user) return null;
  return { userId: user.id, email: user.email, name: user.name };
}
