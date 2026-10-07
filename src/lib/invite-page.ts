import type { InvitationPreview } from "@/db/sharing";
import { maskEmail, normalizeEmail, type InviteRole } from "@/lib/sharing";

/** Everything the invitation page may show, decided here and nowhere else. */
export type InvitePage =
  | { kind: "invalid" }
  | { kind: "signed_out" }
  | {
      kind: "ready";
      trip: { title: string; start_date: string; end_date: string };
      inviter: string;
      role: InviteRole;
    }
  | { kind: "wrong_account"; trip: { title: string }; inviter: string; hint: string; signedInAs: string | null }
  | { kind: "unverified_email"; trip: { title: string }; hint: string }
  | { kind: "expired" | "revoked" | "used"; trip: { title: string }; inviter: string }
  | { kind: "already_member" | "owner" | "accepted_by_you"; tripId: string; title: string };

export type InviteViewer = { id: string; email: string | null; emailVerified: boolean };

/**
 * Pure decision for a signed-in visitor, given the minimal preview. The
 * result never includes the full invited address, the plan, bookings or
 * other members — only a trip title, dates, inviter and role.
 */
export function decideInvitePage(preview: InvitationPreview, viewer: InviteViewer, isMember: boolean): InvitePage {
  const base = { trip: { title: preview.trip.title }, inviter: preview.inviter_name };

  if (preview.state === "accepted") {
    return preview.accepted_by === viewer.id
      ? { kind: "accepted_by_you", tripId: preview.trip.id, title: preview.trip.title }
      : { kind: "used", ...base };
  }
  if (preview.state === "revoked") return { kind: "revoked", ...base };
  if (preview.state === "expired") return { kind: "expired", ...base };

  if (preview.owner_id === viewer.id) return { kind: "owner", tripId: preview.trip.id, title: preview.trip.title };
  if (isMember) return { kind: "already_member", tripId: preview.trip.id, title: preview.trip.title };

  if (preview.email_bound) {
    const hint = preview.email_hint ?? "";
    if (!viewer.emailVerified || !viewer.email) return { kind: "unverified_email", trip: base.trip, hint };
    if (normalizeEmail(viewer.email) !== preview.email) {
      return { kind: "wrong_account", ...base, hint, signedInAs: maskEmail(normalizeEmail(viewer.email)) };
    }
  }
  return {
    kind: "ready",
    trip: { title: preview.trip.title, start_date: preview.trip.start_date, end_date: preview.trip.end_date },
    inviter: preview.inviter_name,
    role: preview.role,
  };
}
