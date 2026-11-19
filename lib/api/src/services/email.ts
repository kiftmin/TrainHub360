// Email transport abstraction. Phase 5.1 requires a real provider selected by
// env var; until one is configured we log to the console so local/dev flows work.
// Decision recorded 2026-11-19: provider selection is deferred, console sender is
// the default, and EMAIL_PROVIDER is reserved for SMTP|sendgrid|azure-comm.
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

let overrideSender: EmailSender | null = null;

export function setEmailSender(sender: EmailSender | null) {
  overrideSender = sender;
}

export function getEmailSender(): EmailSender {
  return overrideSender ?? consoleEmailSender;
}
