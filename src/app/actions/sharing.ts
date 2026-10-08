"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  acceptInvitationByIdForUser,
  acceptInvitationForUser,
  createInvitationForUser,
  getTripForUser,
  leaveTripForUser,
  recordInvitationDeliveryForUser,
  removeMemberForUser,
  revokeInvitationForUser,
  rotateInvitationForUser,
  updateMemberRoleForUser,
  type InviteOutcome,
} from "@/lib/dal";
import { sendInviteEmail, emailDeliveryConfigured } from "@/lib/email/invitation-email";
import { getCurrentUser } from "@/lib/user";
import { emailInviteSchema, formFields, idSchema, linkInviteSchema, memberRoleSchema } from "@/lib/validation";
import { invitePath, type InviteRole } from "@/lib/sharing";
import type { ActionState } from "@/lib/types";
import { guarded, invalid, notFound } from "./shared";

/**
 * What the owner sees after creating / replacing an invitation. The raw link
 * path exists only in this response — the database keeps a hash.
 */
type Delivery = "sent" | "failed" | "not_configured" | "not_requested";

export type InviteState = ActionState & {
  invite?: {
    id: string;
    path: string;
    email: string | null;
    role: InviteRole;
    expiresAt: string;
    /** "sent" only if the provider accepted the message; "not_requested" for plain links. */
    delivery: Delivery;
  };
};

const refresh = (tripId: string) => revalidatePath(`/trips/${tripId}`, "layout");

const REFUSALS: Record<string, string> = {
  not_found: "Trip not found.",
  rate_limited: "You’ve created a lot of invitations in the last hour. Please wait a bit and try again.",
  too_many_pending: "There are already many open invitations. Revoke some you no longer need first.",
  too_many_members: "This trip has reached its limit of members.",
  already_member: "That person already has access to this trip.",
  already_invited: "That person already has an open invitation. Use “Send again” to replace it.",
  is_owner: "That’s your own address — you already manage this trip.",
  cooldown: "That invitation was just sent. Please wait a minute before sending it again.",
  too_many_sends: "This invitation has been sent the maximum number of times. Create a new one instead.",
};

function refused(outcome: Extract<InviteOutcome, { ok: false }>): InviteState {
  return { ok: false, message: REFUSALS[outcome.reason] ?? "That invitation couldn’t be created." };
}

/** Email the invitation (when configured) and record exactly what happened. */
async function deliver(
  tripId: string,
  issued: Extract<InviteOutcome, { ok: true }>,
): Promise<"sent" | "failed" | "not_configured"> {
  const [trip, user] = await Promise.all([getTripForUser(tripId), getCurrentUser()]);
  let status: "sent" | "failed" | "not_configured" = "not_configured";
  if (issued.email && trip && emailDeliveryConfigured()) {
    const result = await sendInviteEmail({
      to: issued.email,
      inviterName: user?.displayName ?? "A traveler",
      tripTitle: trip.title,
      role: issued.role,
      expiresAt: issued.expires_at,
      invitePath: invitePath(issued.token),
    });
    status = result.status;
  }
  await recordInvitationDeliveryForUser(tripId, issued.id, issued.token, status);
  return status;
}

function issuedState(issued: Extract<InviteOutcome, { ok: true }>, delivery: Delivery): InviteState {
  const invite = {
    id: issued.id,
    path: invitePath(issued.token),
    email: issued.email,
    role: issued.role,
    expiresAt: issued.expires_at,
    delivery,
  };
  const message =
    delivery === "sent"
      ? "Invitation emailed. You can also copy the link."
      : delivery === "failed"
        ? "The email couldn’t be sent. Copy the invitation link and share it yourself."
        : delivery === "not_configured"
          ? issued.email
            ? "Email delivery is not configured, so nothing was sent. Copy the invitation link and share it yourself."
            : "Invitation link created."
          : "Invitation link created.";
  return { ok: true, message, invite };
}

/** Invite a specific person by email. Only that verified email can accept. */
export async function inviteByEmail(tripId: string, _prev: InviteState, formData: FormData): Promise<InviteState> {
  const parsed = emailInviteSchema.safeParse(formFields(formData, ["email", "role"] as const));
  if (!parsed.success) return invalid(parsed.error);
  const result = await guarded("inviteByEmail", async () => {
    const outcome = await createInvitationForUser(tripId, { email: parsed.data.email, role: parsed.data.role });
    if (!outcome.ok) return refused(outcome);
    return issuedState(outcome, await deliver(tripId, outcome));
  });
  if (result.ok) refresh(tripId);
  return result;
}

/** A single-use link for whoever the owner shares it with. Needs sign-in and an explicit accept. */
export async function createInviteLink(tripId: string, _prev: InviteState, formData: FormData): Promise<InviteState> {
  const parsed = linkInviteSchema.safeParse(formFields(formData, ["role"] as const));
  if (!parsed.success) return invalid(parsed.error);
  const result = await guarded("createInviteLink", async () => {
    const outcome = await createInvitationForUser(tripId, { email: null, role: parsed.data.role });
    if (!outcome.ok) return refused(outcome);
    await recordInvitationDeliveryForUser(tripId, outcome.id, outcome.token, "not_configured");
    return issuedState(outcome, "not_requested");
  });
  if (result.ok) refresh(tripId);
  return result;
}

/**
 * Replace an invitation's link. The previous link stops working at once.
 * `sendEmail` also emails an email-bound invitation (if delivery is configured).
 */
export async function replaceInvitation(tripId: string, invitationId: string, sendEmail: boolean): Promise<InviteState> {
  if (!idSchema.safeParse(invitationId).success) return notFound("Invitation");
  const result = await guarded("replaceInvitation", async () => {
    const outcome = await rotateInvitationForUser(tripId, invitationId, sendEmail);
    if (!outcome.ok) return refused(outcome);
    if (!sendEmail || !outcome.email) {
      await recordInvitationDeliveryForUser(tripId, outcome.id, outcome.token, "not_configured");
      return issuedState(outcome, "not_requested");
    }
    return issuedState(outcome, await deliver(tripId, outcome));
  });
  if (result.ok) refresh(tripId);
  return result;
}

export async function revokeInvitation(tripId: string, invitationId: string): Promise<ActionState> {
  const result = await guarded("revokeInvitation", async () =>
    (await revokeInvitationForUser(tripId, invitationId))
      ? { ok: true, message: "Invitation revoked. Its link no longer works." }
      : notFound("Invitation"),
  );
  if (result.ok) refresh(tripId);
  return result;
}

export async function changeMemberRole(tripId: string, userId: string, role: string): Promise<ActionState> {
  const parsed = memberRoleSchema.safeParse({ userId, role });
  if (!parsed.success) return { ok: false, message: "Choose Editor or Viewer." };
  const result = await guarded("changeMemberRole", async () => {
    const outcome = await updateMemberRoleForUser(tripId, parsed.data.userId, parsed.data.role);
    if (outcome.ok) return { ok: true, message: "Role updated." };
    return outcome.reason === "owner" ? { ok: false, message: "The owner’s role can’t be changed." } : notFound("Member");
  });
  if (result.ok) refresh(tripId);
  return result;
}

export async function removeMember(tripId: string, userId: string): Promise<ActionState> {
  const result = await guarded("removeMember", async () => {
    const outcome = await removeMemberForUser(tripId, userId);
    if (outcome.ok) return { ok: true, message: "Removed from the trip. What they added stays." };
    return outcome.reason === "owner" ? { ok: false, message: "The owner can’t be removed." } : notFound("Member");
  });
  if (result.ok) refresh(tripId);
  return result;
}

/** A member leaves. The owner can't — they manage the trip (delete it instead). */
export async function leaveTrip(tripId: string): Promise<ActionState> {
  const result = await guarded("leaveTrip", async () =>
    (await leaveTripForUser(tripId))
      ? { ok: true }
      : { ok: false, message: "You can only leave a trip that was shared with you." },
  );
  if (!result.ok) return result;
  revalidatePath("/trips");
  redirect("/trips?left=1");
}

export type AcceptState = ActionState & { status?: string };

const ACCEPT_MESSAGES: Record<string, string> = {
  invalid: "This invitation isn’t valid anymore.",
  revoked: "This invitation was revoked by the person who sent it.",
  expired: "This invitation has expired. Ask for a new one.",
  accepted_by_other: "This invitation has already been used.",
  unverified_email: "We couldn’t confirm the email address on your account, so this invitation can’t be accepted.",
  wrong_account: "This invitation was sent to a different account.",
  too_many_members: "This trip has reached its limit of members.",
};

/** The explicit "Accept invitation" click. Signing in alone never gets here. */
// The (prev, formData) parameters are the form-action signature; the token is the only input.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function acceptInvitation(token: string, _prev: AcceptState, _formData: FormData): Promise<AcceptState> {
  return finishAccept("acceptInvitation", () => acceptInvitationForUser(token));
}

/** The same click on the invitation page opened from the inbox (addressed by invitation id, never the token). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function acceptInvitationById(invitationId: string, _prev: AcceptState, _formData: FormData): Promise<AcceptState> {
  return finishAccept("acceptInvitationById", () => acceptInvitationByIdForUser(invitationId));
}

async function finishAccept(
  context: string,
  accept: () => Promise<Awaited<ReturnType<typeof acceptInvitationForUser>>>,
): Promise<AcceptState> {
  let destination: string | null = null;
  const result = await guarded(context, async () => {
    const outcome = await accept();
    if ("tripId" in outcome) {
      destination = `/trips/${outcome.tripId}`;
      return { ok: true };
    }
    return { ok: false, message: ACCEPT_MESSAGES[outcome.status] ?? "That invitation couldn’t be accepted." };
  });
  if (!result.ok || !destination) return result;
  revalidatePath("/trips");
  redirect(`${destination}?joined=1`);
}
