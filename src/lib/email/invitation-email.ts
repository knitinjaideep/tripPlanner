import "server-only";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type InviteRole } from "@/lib/sharing";

/**
 * Invitation email — the only place that talks to an email provider.
 *
 * One provider (Resend's HTTPS API, called with fetch: no SDK, no new
 * dependency). It is configured entirely by server-side environment
 * variables; when any is missing nothing is sent and the caller says so
 * ("Email delivery is not configured") while "Copy invite link" keeps working.
 *
 *   APP_ORIGIN          canonical https origin used in links, e.g. https://travel.example.com
 *   RESEND_API_KEY      server-side API key
 *   INVITE_EMAIL_FROM   verified sender, e.g. "Atlas <invites@example.com>"
 *   INVITE_EMAIL_DEV_INBOX  optional: send every invitation to this address instead (development)
 *
 * The link is built from APP_ORIGIN only — never from a request Host header.
 */

export type EmailConfig = { origin: string; apiKey: string; from: string; devInbox: string | null };

/** The canonical public origin, validated (https, or http on localhost for development). */
export function getAppOrigin(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.APP_ORIGIN?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function getEmailConfig(env: NodeJS.ProcessEnv = process.env): EmailConfig | null {
  const origin = getAppOrigin(env);
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.INVITE_EMAIL_FROM?.trim();
  if (!origin || !apiKey || !from) return null;
  return { origin, apiKey, from, devInbox: env.INVITE_EMAIL_DEV_INBOX?.trim() || null };
}

export const emailDeliveryConfigured = () => getEmailConfig() !== null;

export type InviteEmail = {
  to: string;
  inviterName: string;
  tripTitle: string;
  role: InviteRole;
  expiresAt: string;
  /** Path only (`/invite/<token>`); joined to the configured origin here. */
  invitePath: string;
};

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Strip control characters / newlines so names cannot inject headers or fake lines. */
const oneLine = (value: string) => value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();

const formatExpiry = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(new Date(iso)) + " (UTC)";

/**
 * Message content. Deliberately contains no itinerary, booking, address or
 * member details — only who invited, which trip, the role, the expiry and
 * the accept link.
 */
export function buildInviteMessage(mail: InviteEmail, origin: string) {
  const inviter = oneLine(mail.inviterName).slice(0, 80) || "A traveler";
  const trip = oneLine(mail.tripTitle).slice(0, 120);
  const url = `${origin}${mail.invitePath}`;
  const role = ROLE_LABELS[mail.role];
  const expiry = formatExpiry(mail.expiresAt);
  const subject = `${inviter} invited you to “${trip}” on Atlas`;
  const text = [
    `${inviter} invited you to join the trip “${trip}” on Atlas as ${role === "Editor" ? "an Editor" : "a Viewer"}.`,
    ROLE_DESCRIPTIONS[mail.role],
    "",
    `Accept the invitation: ${url}`,
    "",
    `This invitation can be used once and expires on ${expiry}.`,
    "You will be asked to sign in, then to confirm. If you were not expecting this, ignore this email.",
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#FAF6EC;font-family:Arial,Helvetica,sans-serif;color:#183A2F">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border:1px solid #D9E6C7;border-radius:12px">
<tr><td style="padding:28px">
<p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#3E7A3A">Atlas</p>
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.25">${escapeHtml(inviter)} invited you to “${escapeHtml(trip)}”</h1>
<p style="margin:0 0 4px;font-size:16px;line-height:1.5"><strong>${escapeHtml(role)}</strong></p>
<p style="margin:0 0 20px;font-size:16px;line-height:1.5;color:#4b5b50">${escapeHtml(ROLE_DESCRIPTIONS[mail.role])}</p>
<p style="margin:0 0 20px"><a href="${escapeHtml(url)}" style="display:inline-block;background:#3E7A3A;color:#ffffff;text-decoration:none;font-weight:bold;font-size:16px;padding:14px 22px;border-radius:10px">Accept invitation</a></p>
<p style="margin:0;font-size:13px;line-height:1.5;color:#666B55">This invitation can be used once and expires on ${escapeHtml(expiry)}. You will be asked to sign in, then to confirm. If you were not expecting it, you can ignore this email.</p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html, url };
}

export type MailTransport = (message: {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  apiKey: string;
}) => Promise<{ accepted: boolean }>;

/** Resend over HTTPS. Credentials stay on the server; the response body is never logged. */
export const resendTransport: MailTransport = async ({ apiKey, from, to, subject, text, html }) => {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, text, html }),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  return { accepted: response.ok };
};

export type SendResult = { status: "sent" | "failed" | "not_configured" };

/**
 * "sent" only when the provider accepted the message. Anything else — missing
 * configuration, a rejection, a timeout — is reported as it is, never as sent.
 * `transport` and `config` exist so tests can use a mock; nothing real is sent.
 */
export async function sendInviteEmail(
  mail: InviteEmail,
  deps: { config?: EmailConfig | null; transport?: MailTransport } = {},
): Promise<SendResult> {
  const config = deps.config === undefined ? getEmailConfig() : deps.config;
  if (!config) return { status: "not_configured" };
  const message = buildInviteMessage(mail, config.origin);
  try {
    const { accepted } = await (deps.transport ?? resendTransport)({
      from: config.from,
      to: config.devInbox ?? mail.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      apiKey: config.apiKey,
    });
    return { status: accepted ? "sent" : "failed" };
  } catch (error) {
    // The name only — never the request, which contains the invitation link.
    console.error("[rove] invitation email failed:", (error as Error)?.name);
    return { status: "failed" };
  }
}
