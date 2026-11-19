import { db } from "../db.js";
import { getEmailSender } from "./email.js";
import { appUrl } from "./links.js";

export interface NotifyPayload {
  title: string;
  body?: string;
  link?: string;
  email?: boolean;
}

// Creates the in-app notification record and (best effort) sends an email.
// Never throws: notification failures must not roll back the business action.
export async function notify(userId: string, type: string, payload: NotifyPayload): Promise<void> {
  try {
    const user = await db.user.findUnique({ where: { id: userId }, select: { email: true, orgId: true } }).catch(() => null);
    if (!user) return;
    await db.notification.create({
      data: { userId, orgId: user.orgId, type, title: payload.title, body: payload.body ?? null, link: payload.link ?? null },
    }).catch(() => null);
    if (payload.email !== false) {
      // The link is stored app-relative (the bell navigates in-app); the email needs an
      // absolute one, because the recipient has no origin to resolve "/x" against.
      const text = [payload.body ?? payload.title, payload.link ? appUrl(payload.link) : null]
        .filter(Boolean)
        .join("\n\n");
      await getEmailSender().send({
        to: user.email,
        subject: payload.title,
        text,
        html: `<p>${(payload.body ?? payload.title).replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>${
          payload.link ? `<p><a href="${appUrl(payload.link)}">Open in TrainHub360</a></p>` : ""
        }`,
      }).catch(() => false);
    }
  } catch {
    // swallow — notification is a side effect
  }
}

export async function notifyMany(userIds: string[], type: string, payload: NotifyPayload): Promise<number> {
  let sent = 0;
  for (const userId of [...new Set(userIds.filter(Boolean))]) {
    await notify(userId, type, payload);
    sent += 1;
  }
  return sent;
}
