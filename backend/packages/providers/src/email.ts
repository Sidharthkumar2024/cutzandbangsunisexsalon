import nodemailer from "nodemailer";
import type { EmailProvider, SendResult, EmailAttachment } from "@cutz/types";

/** SMTP email provider. In dev with no SMTP config, logs instead of sending. */
export type SmtpEmailConfig = {
  enabled?: boolean;
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  password?: string;
  from?: string;
};

export class SmtpEmailProvider implements EmailProvider {
  private transport: nodemailer.Transporter | null;
  private from: string;

  constructor(config?: SmtpEmailConfig) {
    const port = config?.port ?? Number(process.env.SMTP_PORT ?? 587);
    const host = config?.host ?? process.env.SMTP_HOST;
    const user = config?.user ?? process.env.SMTP_USER;
    const password = config?.password ?? process.env.SMTP_PASS;
    this.from = config?.from ?? process.env.EMAIL_FROM ?? "Cutz & Bangs <noreply@localhost>";
    if (config?.enabled !== false && host) {
      this.transport = nodemailer.createTransport({
        host,
        port,
        secure: config?.secure ?? port === 465,
        auth: user
          ? { user, pass: password }
          : undefined,
      });
    } else {
      this.transport = null;
    }
  }

  async health() {
    if (!this.transport) return { configured: false, connected: false, detail: "Add SMTP host and sender details." };
    try {
      await this.transport.verify();
      return { configured: true, connected: true, detail: "SMTP connection verified" };
    } catch (error) {
      return { configured: true, connected: false, detail: error instanceof Error ? error.message : "SMTP unavailable" };
    }
  }

  async send(input: {
    to: string;
    subject: string;
    html: string;
    attachments?: EmailAttachment[];
    dedupeKey?: string;
  }): Promise<SendResult> {
    if (!this.transport) {
      if (process.env.NODE_ENV === "production") {
        return { externalId: "", status: "failed", error: "smtp_not_configured" };
      }
      const att = input.attachments?.length ? ` attachments=${input.attachments.map((a) => a.filename).join(",")}` : "";
      console.log(`[email:dev] to=${input.to} subject="${input.subject}"${att}`);
      return { externalId: `dev-${Date.now()}`, status: "sent" };
    }
    const info = await this.transport.sendMail({
      from: this.from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      // nodemailer accepts either inline `content` bytes or a `path`.
      attachments: input.attachments?.map((a) => ({ filename: a.filename, content: a.content, path: a.path })),
    });
    return { externalId: info.messageId, status: "sent" };
  }
}
