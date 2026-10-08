import "server-only";
import { actionLabel, type PreviewContent } from "@/lib/evening-preview";
import { getEmailConfig, resendTransport, type EmailConfig, type MailTransport, type SendResult } from "./invitation-email";

/**
 * Optional email copy of the evening preview. Reuses the one transactional
 * provider the app already has for invitations (Resend over fetch) and its
 * configuration — nothing new is added. With that unconfigured nothing is
 * sent and the in-app preview carries on.
 *
 * The message holds only what the in-app preview holds (titles, times, one
 * poll question) plus two links built from APP_ORIGIN. Both links require
 * signing in; the second turns the previews off.
 */

const escapeHtml = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function buildPreviewEmail(content: PreviewContent, tripId: string, origin: string) {
  const view = `${origin}${content.href}`;
  const settings = `${origin}/trips/${tripId}?evening=1`;
  const action = actionLabel(content);
  const subject = content.title;
  const text = [...content.lines, "", `${action}: ${view}`, "", `Turn off evening previews for this trip: ${settings}`, "(You’ll be asked to sign in.)"].join("\n");
  const [head, , ...rest] = content.lines;
  const html = `<!doctype html><html><body style="margin:0;background:#FAF6EC;font-family:Arial,Helvetica,sans-serif;color:#183A2F">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border:1px solid #D9E6C7;border-radius:12px"><tr><td style="padding:28px">
<p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#3E7A3A">Atlas</p>
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.25">${escapeHtml(head)}</h1>
${rest.filter(Boolean).map((l) => `<p style="margin:0 0 12px;font-size:16px;line-height:1.5">${escapeHtml(l)}</p>`).join("\n")}
<p style="margin:16px 0 20px"><a href="${escapeHtml(view)}" style="display:inline-block;background:#3E7A3A;color:#ffffff;text-decoration:none;font-weight:bold;font-size:16px;padding:14px 22px;border-radius:10px">${escapeHtml(action)}</a></p>
<p style="margin:0;font-size:13px;line-height:1.5;color:#666B55"><a href="${escapeHtml(settings)}" style="color:#3E7A3A">Turn off evening previews for this trip</a> (you’ll be asked to sign in).</p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}

export type PreviewSender = (input: { to: string; content: PreviewContent; tripId: string; idempotencyKey: string }) => Promise<"sent" | "failed">;

/** The real sender, or null when no provider is configured. `deps` lets tests inject a mock — nothing real is sent from tests. */
export function createPreviewSender(deps: { config?: EmailConfig | null; transport?: MailTransport } = {}): PreviewSender | null {
  const config = deps.config === undefined ? getEmailConfig() : deps.config;
  if (!config) return null;
  return async ({ to, content, tripId, idempotencyKey }) => {
    const message = buildPreviewEmail(content, tripId, config.origin);
    try {
      const { accepted } = await (deps.transport ?? resendTransport)({
        from: config.from,
        to: config.devInbox ?? to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        apiKey: config.apiKey,
        idempotencyKey,
      });
      return accepted ? "sent" : "failed";
    } catch (error) {
      console.error("[rove] evening preview email failed:", (error as Error)?.name);
      return "failed";
    }
  };
}

export type { SendResult };
