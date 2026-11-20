// Email transport abstraction. Phase 5.1 / A.2: a real provider selected by env var.
//
// EMAIL_PROVIDER:
//   smtp  - a real SMTP server, configured from SMTP_* (see below)
//   (unset or "console") - log to the console, so local/dev flows work without a server
//
// [CONFIRM] 2026-11-19: when EMAIL_PROVIDER=smtp but SMTP_HOST is missing we throw at send
// time rather than silently falling back to the console sender. A deployment that believes
// it is sending mail must not quietly stop: a registration that never reaches the user is
// worse than a loud failure. Set EMAIL_PROVIDER unset/console to opt out deliberately.
//
// Env for smtp:
//   SMTP_HOST (required), SMTP_PORT (default 587), SMTP_USER, SMTP_PASS,
//   SMTP_SECURE ("true" for implicit TLS on 465; otherwise STARTTLS is used when offered),
//   SMTP_FROM (default: no-reply@<SMTP_HOST>)
//
// Round 6 / A.2 gaps closed here (see trainhub360-review-round7.md §2):
//   #1 the console sender now prints the whole body, links included, outside production
//   #2 assertEmailConfiguration() refuses to start a production deployment that would log
//      mail instead of sending it, or that points its links at localhost
//   #3 a failed send is logged and recorded (EmailFailure) instead of being swallowed
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { appBaseUrl, appUrl } from "./links.js";

export interface EmailAttachment {
  filename: string;
  contentType: string;
  content: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: EmailAttachment[];
  /** What kind of mail this is ("activation", "password_reset", "notification", …). Recorded with a failure. */
  kind?: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<boolean>;
}

/**
 * The development sender. It used to log only the recipient and the subject, which made
 * every activation and reset link invisible when no provider is configured — the default
 * setup (round 7, gap 1). It now prints the body, so the link can be copied out of the
 * terminal. Production never gets here: assertEmailConfiguration() refuses to boot.
 */
export const consoleEmailSender: EmailSender = {
  async send(message) {
    const lines = [
      "",
      "─────────────────────────────── [email] ───────────────────────────────",
      `to:      ${message.to}`,
      `subject: ${message.subject}`,
      ...(message.attachments?.length ? [`files:   ${message.attachments.map((a) => a.filename).join(", ")}`] : []),
      "",
      message.text,
      "───────────────────────────────────────────────────────────────────────",
      "",
    ];
    console.log(lines.join("\n"));
    return true;
  },
};

function smtpFrom(): string {
  const explicit = (process.env.SMTP_FROM ?? "").trim();
  if (explicit) return explicit;
  const host = (process.env.SMTP_HOST ?? "").trim();
  return host ? `no-reply@${host}` : "no-reply@localhost";
}

/** The SMTP sender. Throws (rather than falling back) when the server is not configured. */
export function smtpEmailSender(): EmailSender {
  let transporter: Transporter | null = null;

  function getTransporter(): Transporter {
    if (transporter) return transporter;
    const host = (process.env.SMTP_HOST ?? "").trim();
    if (!host) {
      throw new Error("EMAIL_PROVIDER=smtp but SMTP_HOST is not set — mail cannot be sent");
    }
    const port = Number(process.env.SMTP_PORT ?? 587);
    const user = process.env.SMTP_USER ?? "";
    transporter = nodemailer.createTransport({
      host,
      port: Number.isFinite(port) ? port : 587,
      secure: String(process.env.SMTP_SECURE ?? "").toLowerCase() === "true",
      auth: user ? { user, pass: process.env.SMTP_PASS ?? "" } : undefined,
    });
    return transporter;
  }

  return {
    async send(message) {
      const info = await getTransporter().sendMail({
        from: smtpFrom(),
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        attachments: message.attachments?.map((a) => ({
          filename: a.filename,
          contentType: a.contentType,
          content: a.content,
          encoding: "base64",
        })),
      });
      return Boolean(info.accepted?.length);
    },
  };
}

let overrideSender: EmailSender | null = null;
let providerSender: EmailSender | null = null;

export function setEmailSender(sender: EmailSender | null) {
  overrideSender = sender;
}

/** Which sender getEmailSender() will use. Useful in logs and tests. */
export function emailProviderName(): "smtp" | "console" {
  return (process.env.EMAIL_PROVIDER ?? "").trim().toLowerCase() === "smtp" ? "smtp" : "console";
}

export function getEmailSender(): EmailSender {
  if (overrideSender) return overrideSender;
  if (emailProviderName() === "smtp") {
    providerSender ??= smtpEmailSender();
    return providerSender;
  }
  return consoleEmailSender;
}

/**
 * Round 7 gap 2. With the defaults, a production deployment silently logged its mail to
 * the console and sent activation links to http://localhost:5173. Both are now startup
 * errors in production and warnings in development, so the misconfiguration is visible
 * before a user is locked out of their account.
 *
 * Returns the problems found (for logs/tests). Throws when NODE_ENV=production and
 * EMAIL_STRICT (default: on in production) is not "false".
 */
export function emailConfigurationProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  const problems: string[] = [];
  const provider = (env.EMAIL_PROVIDER ?? "").trim().toLowerCase() === "smtp" ? "smtp" : "console";
  if (provider === "console") {
    problems.push(
      "EMAIL_PROVIDER is not \"smtp\": outbound mail would only be written to this process's log, so activation and password-reset links never reach anyone",
    );
  } else if (!(env.SMTP_HOST ?? "").trim()) {
    problems.push("EMAIL_PROVIDER=smtp but SMTP_HOST is empty, so every send fails at send time");
  }
  const base = (env.APP_BASE_URL ?? "").trim();
  if (!base) {
    problems.push(`APP_BASE_URL is not set: links in email would point at ${appBaseUrl()}`);
  } else if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(base)) {
    problems.push(`APP_BASE_URL points at ${base}, which only resolves on the machine sending the mail`);
  }
  return problems;
}

/**
 * Called once at startup (index.ts). Warns in development, refuses to start in production
 * unless EMAIL_STRICT=false says the deployment accepts logging its mail.
 */
export function assertEmailConfiguration(env: NodeJS.ProcessEnv = process.env): string[] {
  const problems = emailConfigurationProblems(env);
  if (!problems.length) return problems;
  const production = env.NODE_ENV === "production";
  const strict = production && String(env.EMAIL_STRICT ?? "true").toLowerCase() !== "false";
  if (strict) {
    throw new Error(`email is not configured for production:\n - ${problems.join("\n - ")}`);
  }
  for (const problem of problems) console.warn(`[email] ${production ? "WARNING" : "dev notice"}: ${problem}`);
  return problems;
}

/** Escapes text for interpolation into an HTML body. Exported because callers build their own bodies. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A minimal HTML body for plain-text messages, with links made absolute. */
export function toHtml(text: string): string {
  const escaped = escapeHtml(text);
  return escaped.replace(/(^|\s)(\/\S*)/g, (_m, space: string, path: string) => `${space}${appUrl(path)}`);
}
