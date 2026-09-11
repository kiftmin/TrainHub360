import { db } from "../db.js";

export async function dispatchWebhook(orgId: string, eventType: string, payload: Record<string, unknown>): Promise<{ delivered: number; urls: string[] }> {
  const org = await db.organization.findUnique({ where: { id: orgId } }).catch(() => null);
  let urls: string[] = [];
  try {
    urls = JSON.parse(org?.webhookUrls ?? "[]") as string[];
  } catch {
    urls = [];
  }
  let delivered = 0;
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-trainhub360-event": eventType },
        body: JSON.stringify({ event: eventType, orgId, at: new Date().toISOString(), ...payload }),
      });
      if (res.ok) delivered += 1;
    } catch {
      /* best-effort delivery */
    }
  }
  return { delivered, urls };
}
