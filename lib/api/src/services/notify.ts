import { db } from "../db.js";
import { getEmailSender, escapeHtml } from "./email.js";
import { appUrl } from "./links.js";
import { recordEmailFailure } from "./emailFailures.js";
import { isUniqueViolation } from "./dbErrors.js";

export interface NotifyPayload {
  title: string;
  body?: string;
  link?: string;
  email?: boolean;
  /** Round 8 / D.2: calendar invitations and updates travel with the mail as an .ics file. */
  attachments?: Array<{ filename: string; contentType: string; content: string }>;
  /** Round 13 / 1.2: opt-in completion dedupe key (unique per user via a filtered index). */
  dedupeKey?: string;
}

// Creates the in-app notification record and (best effort) sends an email.
// Never throws: notification failures must not roll back the business action.
// Round 7 gap 3: "best effort" used to mean "silently ignored" — the in-app insert and the
// email send both ended in an empty `.catch`. Both are now logged, and a failed send is
// recorded in `email_failures` so an operator can see that mail is not going out.
export async function notify(userId: string, type: string, payload: NotifyPayload): Promise<void> {
  try {
    const user = await db.user.findUnique({ where: { id: userId }, select: { email: true, orgId: true } }).catch(() => null);
    if (!user) return;
    try {
      await db.notification.create({
        data: {
          userId, orgId: user.orgId, type, title: payload.title, body: payload.body ?? null,
          link: payload.link ?? null, dedupeKey: payload.dedupeKey ?? null,
        },
      });
    } catch (e) {
      if (payload.dedupeKey && isUniqueViolation(e)) {
        // Already announced for this completion event: no second notification and no second email.
        return;
      }
      console.error(`[notify] could not store the in-app notification for ${userId} (${type}):`, e instanceof Error ? e.message : e);
    }
    if (payload.email !== false) {
      // The link is stored app-relative (the bell navigates in-app); the email needs an
      // absolute one, because the recipient has no origin to resolve "/x" against.
      const bodyText = payload.body ?? payload.title;
      const text = [bodyText, payload.link ? appUrl(payload.link) : null]
        .filter(Boolean)
        .join("\n\n");
      try {
        const ok = await getEmailSender().send({
          to: user.email,
          subject: payload.title,
          kind: `notification:${type}`,
          text,
          html: `<p>${escapeHtml(bodyText)}</p>${
            payload.link ? `<p><a href="${escapeHtml(appUrl(payload.link))}">Open in TrainHub360</a></p>` : ""
          }`,
          attachments: payload.attachments,
        });
        if (!ok) {
          await recordEmailFailure({ to: user.email, subject: payload.title, kind: `notification:${type}`, error: "sender rejected the message", context: { userId } });
        }
      } catch (error) {
        await recordEmailFailure({ to: user.email, subject: payload.title, kind: `notification:${type}`, error, context: { userId } });
      }
    }
  } catch (e) {
    // Still swallowed here — a notification is a side effect of the caller's action — but
    // not silently: this is the last line of defence for an unexpected failure.
    console.error(`[notify] failed for ${userId} (${type}):`, e instanceof Error ? e.message : e);
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
