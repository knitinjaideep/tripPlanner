/**
 * Roles, permissions and email helpers for shared trips. Pure and
 * client-safe: nothing here touches the database or secrets.
 */

export const TRIP_ROLES = ["owner", "editor", "viewer"] as const;
export type TripRole = (typeof TRIP_ROLES)[number];
export type InviteRole = Exclude<TripRole, "owner">;

export const INVITE_ROLES: readonly InviteRole[] = ["editor", "viewer"];
export const DEFAULT_INVITE_ROLE: InviteRole = "editor";

export const ROLE_LABELS: Record<TripRole, string> = {
  owner: "Owner",
  editor: "Editor",
  viewer: "Viewer",
};

export const ROLE_DESCRIPTIONS: Record<TripRole, string> = {
  owner: "Manages the trip, invitations, and members.",
  editor: "Can view the trip and contribute to the plan.",
  viewer: "Can view the trip without making changes.",
};

/** What a role may do. The server enforces these; the UI only mirrors them. */
export type Capability =
  | "read" //          see every part of the trip
  | "contribute" //    itinerary, Explore, bookings, packing, memories
  | "manage_trip" //   edit trip settings, delete the trip
  | "manage_members"; // invitations, roles, removals

const CAPABILITIES: Record<TripRole, readonly Capability[]> = {
  owner: ["read", "contribute", "manage_trip", "manage_members"],
  editor: ["read", "contribute"],
  viewer: ["read"],
};

export function can(role: TripRole | null | undefined, capability: Capability) {
  return role ? CAPABILITIES[role].includes(capability) : false;
}

/** Signed in, a member of the trip, but the role does not allow this change. */
export class ForbiddenError extends Error {
  constructor(message = "You have view-only access to this trip.") {
    super(message);
  }
}

export const isInviteRole = (value: unknown): value is InviteRole =>
  value === "editor" || value === "viewer";

/** Invitations expire after a week unless the owner replaces them. */
export const INVITE_TTL_DAYS = 7;
export const INVITE_TTL_MS = INVITE_TTL_DAYS * 24 * 60 * 60 * 1000;

/** Most invitations an owner can create per trip per hour, and the gap between emails to one invitation. */
export const INVITE_CREATE_LIMIT_PER_HOUR = 20;
export const INVITE_RESEND_COOLDOWN_MS = 60 * 1000;
export const MAX_MEMBERS_PER_TRIP = 20;
export const MAX_PENDING_INVITATIONS = 30;

/**
 * One normalization for every email comparison: surrounding whitespace
 * removed, lower-cased. Deliberately nothing smarter — no Gmail dot or
 * "+tag" equivalence — so only the address the owner typed matches.
 */
export function normalizeEmail(raw: string) {
  return raw.normalize("NFKC").trim().toLowerCase();
}

const EMAIL_PATTERN = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

/** Normalized email, or null when it is not a plausible single address. */
export function parseEmail(raw: string): string | null {
  const email = normalizeEmail(raw);
  if (email.length < 5 || email.length > 320 || !EMAIL_PATTERN.test(email)) return null;
  const [local, domain] = email.split("@");
  if (local.length > 64 || domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) return null;
  return email;
}

/** "n•••@g•••.com" — enough to recognise your own address, not to learn someone else's. */
export function maskEmail(email: string) {
  const [local, domain = ""] = email.split("@");
  const dot = domain.lastIndexOf(".");
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : "";
  return `${local.slice(0, 1)}•••@${host.slice(0, 1)}•••${tld}`;
}

export type InvitationState = "pending" | "expired" | "revoked" | "accepted";

export function invitationState(
  inv: { accepted_at: string | null; revoked_at: string | null; expires_at: string },
  now: Date = new Date(),
): InvitationState {
  if (inv.accepted_at) return "accepted";
  if (inv.revoked_at) return "revoked";
  return new Date(inv.expires_at).getTime() <= now.getTime() ? "expired" : "pending";
}

/** Where an invitation link points, relative to the app origin. The token is the only secret in it. */
export const invitePath = (token: string) => `/invite/${token}`;

/**
 * Short-lived first-party cookie that carries an invitation token across sign-in, so the token
 * never appears in the sign-in redirect (and so never reaches the auth provider).
 */
export const INVITE_COOKIE = "atlas-invite";

/** Tokens are 32 random bytes, base64url: 43 characters. Anything else is rejected before touching the database. */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** An invitation that has not been accepted or revoked (expired ones included, so they can be replaced). */
export type OpenInvitation = {
  id: string;
  email: string | null;
  role: InviteRole;
  expires_at: string;
  created_at: string;
  last_sent_at: string | null;
  send_count: number;
  delivery_status: string;
  accepted_at: string | null;
  revoked_at: string | null;
};

/** Who a trip is shared with, from one person's point of view (plain data — safe to hand to the browser). */
export type ShareView = {
  role: TripRole;
  owner: { name: string };
  /** user id → display name, for "Added by …". */
  people: Record<string, string>;
  members: { user_id: string; role: InviteRole; joined_at: string; name: string; email: string | null; isYou: boolean }[];
  /** Owner only. */
  invitations: OpenInvitation[];
};
