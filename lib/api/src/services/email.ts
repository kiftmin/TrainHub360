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
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { appUrl } from "./links.js";

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
}

export interface EmailSender {
  send(message: EmailMessage): Promise<boolean>;
}

export const consoleEmailSender: EmailSender = {
  async send(message) {
    console.log(`[email] to=${message.to} subject="${message.subject}"${message.attachments?.length ? ` attachments=${message.attachments.map((a) => a.filename).join(",")}` : ""}`);
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

/** A minimal HTML body for plain-text messages, with links made absolute. */
export function toHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped.replace(/(^|\s)(\/\S*)/g, (_m, space: string, path: string) => `${space}${appUrl(path)}`);
}
