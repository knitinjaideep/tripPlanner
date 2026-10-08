import "server-only";
import { getEmailConfig, resendTransport, type EmailConfig, type MailTransport } from "./invitation-email";

/**
 * Optional email copy of a reminder, for people who turned email on. Reuses
 * the one transactional provider the app already has (Resend over fetch) and
 * its configuration — nothing new is added.
 *
 * Deliberately minimal: the one-line reminder and two links that open the app
 * (which asks you to sign in). No confirmation codes, unit numbers, addresses
 * or notes, and no action in the email changes anything — completing or
 * snoozing happens in the app through an authenticated request, never through
 * a link in a message.
 */

const escapeHtml = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export type ReminderEmailInput = {
  to: string;
  tripId: string;
  subject: "booking" | "task";
  subjectId: string;
  title: string;
  body: string;
  idempotencyKey: string;
};

/** Where "View" and "Manage reminders" lead (both are plain, sign-in-required GET pages that change nothing). */
export function reminderLinks(origin: string, input: Pick<ReminderEmailInput, "tripId" | "subject" | "subjectId">) {
  const base = `${origin}/trips/${input.tripId}/${input.subject === "booking" ? "bookings" : "packing"}`;
  const key = input.subject === "booking" ? "booking" : "task";
  return { view: `${base}?${key}=${input.subjectId}`, manage: `${base}?${key}=${input.subjectId}&reminders=1` };
}

export function buildReminderEmail(input: ReminderEmailInput, origin: string) {
  const { view, manage } = reminderLinks(origin, input);
  const label = input.subject === "booking" ? "View booking" : "View task";
  const subject = input.body.length > 90 ? `${input.body.slice(0, 89)}…` : input.body;
  const text = [input.body, "", `${label}: ${view}`, `Manage your reminders: ${manage}`, "(You’ll be asked to sign in. You can turn reminders off there.)"].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#FAF6EC;font-family:Arial,Helvetica,sans-serif;color:#183A2F">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border:1px solid #D9E6C7;border-radius:12px"><tr><td style="padding:28px">
<p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#3E7A3A">Atlas · ${escapeHtml(input.title)}</p>
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3">${escapeHtml(input.body)}</h1>
<p style="margin:16px 0 20px"><a href="${escapeHtml(view)}" style="display:inline-block;background:#3E7A3A;color:#ffffff;text-decoration:none;font-weight:bold;font-size:16px;padding:14px 22px;border-radius:10px">${escapeHtml(label)}</a></p>
<p style="margin:0;font-size:13px;line-height:1.5;color:#666B55"><a href="${escapeHtml(manage)}" style="color:#3E7A3A">Manage your reminders</a> (you’ll be asked to sign in).</p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}

/** "accepted" means the provider took the message — not that anyone read it. */
export type ReminderSender = (input: ReminderEmailInput) => Promise<"sent" | "failed">;

/** The real sender, or null when no provider is configured. `deps` lets tests inject a mock — nothing real is sent from tests. */
export function createReminderSender(deps: { config?: EmailConfig | null; transport?: MailTransport } = {}): ReminderSender | null {
  const config = deps.config === undefined ? getEmailConfig() : deps.config;
  if (!config) return null;
  return async (input) => {
    const message = buildReminderEmail(input, config.origin);
    try {
      const { accepted } = await (deps.transport ?? resendTransport)({
        from: config.from,
        to: config.devInbox ?? input.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        apiKey: config.apiKey,
        idempotencyKey: input.idempotencyKey,
      });
      return accepted ? "sent" : "failed";
    } catch (error) {
      console.error("[rove] reminder email failed:", (error as Error)?.name);
      return "failed";
    }
  };
}
