"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { AlertCircle, Check, Clock, Copy, Link2, Loader2, Mail, Send, Trash2, UserMinus, Users } from "lucide-react";
import { toast } from "sonner";
import {
  changeMemberRole,
  createInviteLink,
  inviteByEmail,
  leaveTrip,
  removeMember,
  replaceInvitation,
  revokeInvitation,
  type InviteState,
} from "@/app/actions/sharing";
import { FormMessage, SubmitButton, TextField, controlClass, secondaryButtonClass } from "@/components/forms/fields";
import { useFormAction } from "@/components/forms/use-form-action";
import { UserAvatar } from "@/components/user-avatar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  DEFAULT_INVITE_ROLE,
  INVITE_ROLES,
  INVITE_TTL_DAYS,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  invitationState,
  type InviteRole,
  type ShareView,
} from "@/lib/sharing";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "./confirm-dialog";

type IssuedInvite = NonNullable<InviteState["invite"]>;

const formatDay = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("") || "?";

/** Header button + dialog. Owners manage invitations and members; everyone else sees who is on the trip. */
export function ShareTripButton({
  tripId,
  tripTitle,
  view,
  emailConfigured,
  appOrigin,
  className,
}: {
  tripId: string;
  tripTitle: string;
  view: ShareView;
  emailConfigured: boolean;
  /** Canonical public origin from server configuration; null → the browser's own origin is used for copied links. */
  appOrigin: string | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const isOwner = view.role === "owner";
  const count = view.members.length + 1;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={cn(
            "focus-ring inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-white/90 px-3.5 text-sm font-semibold text-ink shadow-sm backdrop-blur hover:bg-white",
            className,
          )}
        >
          <Users className="size-[18px]" aria-hidden="true" />
          <span className="sr-only min-[480px]:not-sr-only">{isOwner ? "Share trip" : "People"}</span>
          {count > 1 ? (
            <span className="rounded-full bg-moss-soft px-1.5 text-xs font-semibold text-moss-ink">
              {count}
              <span className="sr-only"> people on this trip</span>
            </span>
          ) : null}
        </button>
      </DialogTrigger>
      <DialogContent
        fullScreenOnPhone
        className="gap-0 bg-background p-0 sm:max-w-xl"
        onOpenAutoFocus={(e) => {
          // Land on the dialog itself, not the first field: no keyboard pops up on phones.
          e.preventDefault();
          (e.currentTarget as HTMLElement).focus();
        }}
      >
        <DialogHeader className="gap-1 border-b border-border px-5 pt-5 pb-4 pr-16 sm:px-6">
          <DialogTitle className="font-display text-2xl leading-tight font-semibold text-ink">
            {isOwner ? "Share this trip" : "People on this trip"}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {isOwner
              ? `Invite people to “${tripTitle}”. They get the whole trip, not just one day.`
              : `Everyone who can see “${tripTitle}”.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-8 px-5 py-5 sm:px-6">
          {isOwner ? (
            <OwnerPanel tripId={tripId} view={view} emailConfigured={emailConfigured} appOrigin={appOrigin} />
          ) : (
            <MemberPanel tripId={tripId} view={view} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ----------------------------- role choice ----------------------------- */

function RoleChoice({ name = "role", defaultValue = DEFAULT_INVITE_ROLE }: { name?: string; defaultValue?: InviteRole }) {
  const group = useId();
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold text-ink">Access</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {INVITE_ROLES.map((role) => (
          <label
            key={role}
            className="focus-within:ring-moss/40 relative flex min-h-11 cursor-pointer gap-3 rounded-xl border border-input bg-white p-3 text-left has-[:checked]:border-moss-ink has-[:checked]:bg-moss-soft focus-within:ring-3"
          >
            <input
              type="radio"
              name={name}
              value={role}
              defaultChecked={role === defaultValue}
              className="mt-1 size-4 shrink-0 accent-[#3e7a3a]"
              aria-describedby={`${group}-${role}`}
            />
            <span className="min-w-0">
              <span className="block text-[0.9375rem] font-semibold text-ink">{ROLE_LABELS[role]}</span>
              <span id={`${group}-${role}`} className="block text-sm text-muted-foreground">
                {ROLE_DESCRIPTIONS[role]}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/* ------------------------------ owner panel ----------------------------- */

function OwnerPanel({
  tripId,
  view,
  emailConfigured,
  appOrigin,
}: {
  tripId: string;
  view: ShareView;
  emailConfigured: boolean;
  appOrigin: string | null;
}) {
  const [issued, setIssued] = useState<IssuedInvite | null>(null);

  return (
    <>
      <section aria-labelledby="invite-heading" className="space-y-5">
        <h3 id="invite-heading" className="font-display text-xl font-semibold text-ink">
          Invite someone
        </h3>
        <EmailDeliveryNote configured={emailConfigured} />
        <InviteByEmail tripId={tripId} emailConfigured={emailConfigured} onIssued={setIssued} />
        <div className="relative text-center text-xs font-semibold tracking-wide text-muted-foreground uppercase" role="separator">
          <span className="relative z-10 bg-background px-3">or</span>
          <span className="absolute inset-x-0 top-1/2 -z-0 h-px bg-border" aria-hidden="true" />
        </div>
        <InviteLink tripId={tripId} onIssued={setIssued} />
        {issued ? <IssuedPanel invite={issued} appOrigin={appOrigin} onDismiss={() => setIssued(null)} /> : null}
      </section>

      <section aria-labelledby="pending-heading" className="space-y-3">
        <h3 id="pending-heading" className="font-display text-xl font-semibold text-ink">
          Open invitations
        </h3>
        {view.invitations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open invitations.</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-white">
            {view.invitations.map((inv) => (
              <PendingRow key={inv.id} tripId={tripId} inv={inv} emailConfigured={emailConfigured} onIssued={setIssued} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="members-heading" className="space-y-3">
        <h3 id="members-heading" className="font-display text-xl font-semibold text-ink">
          People with access
        </h3>
        <ul className="divide-y divide-border rounded-xl border border-border bg-white">
          <li className="flex items-center gap-3 p-3.5">
            <UserAvatar name={view.owner.name} initials={initialsOf(view.owner.name)} className="size-10" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.9375rem] font-semibold text-ink">{view.owner.name} (you)</p>
              <p className="text-sm text-muted-foreground">{ROLE_DESCRIPTIONS.owner}</p>
            </div>
            <span className="rounded-full bg-gold-soft px-2.5 py-1 text-xs font-semibold text-gold-ink">Owner</span>
          </li>
          {view.members.map((m) => (
            <MemberRow key={m.user_id} tripId={tripId} member={m} />
          ))}
        </ul>
        {view.members.length === 0 ? (
          <p className="text-sm text-muted-foreground">Only you for now. Invite someone above.</p>
        ) : null}
      </section>
    </>
  );
}

function EmailDeliveryNote({ configured }: { configured: boolean }) {
  if (configured) return null;
  return (
    <p role="note" className="flex gap-2.5 rounded-xl border border-gold/60 bg-gold-soft/50 p-3.5 text-sm text-ink">
      <Mail className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>
        <strong className="font-semibold">Email delivery is not configured.</strong> Invitations are created and the
        link is ready to copy, but nothing is emailed — send the link yourself.
      </span>
    </p>
  );
}

function InviteByEmail({
  tripId,
  emailConfigured,
  onIssued,
}: {
  tripId: string;
  emailConfigured: boolean;
  onIssued: (invite: IssuedInvite) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const { state, onSubmit, pending } = useFormAction<InviteState>(inviteByEmail.bind(null, tripId));
  useEffect(() => {
    if (state.ok && state.invite) {
      onIssued(state.invite);
      formRef.current?.reset();
    }
  }, [state, onIssued]);

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-4" noValidate>
      <TextField
        name="email"
        idPrefix="invite"
        label="Their email"
        type="email"
        inputMode="email"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="name@example.com"
        error={state.fieldErrors?.email}
        hint="Only this email address can accept, after signing in with it."
      />
      <RoleChoice />
      {!state.ok ? <FormMessage message={state.message} signedOut={state.signedOut} /> : null}
      <SubmitButton pending={pending} pendingLabel="Inviting…" className="w-full sm:w-auto">
        <Send className="size-4" aria-hidden="true" /> {emailConfigured ? "Send invitation" : "Create invitation"}
      </SubmitButton>
    </form>
  );
}

function InviteLink({ tripId, onIssued }: { tripId: string; onIssued: (invite: IssuedInvite) => void }) {
  const { state, onSubmit, pending } = useFormAction<InviteState>(createInviteLink.bind(null, tripId));
  useEffect(() => {
    if (state.ok && state.invite) onIssued(state.invite);
  }, [state, onIssued]);
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div>
        <h4 className="text-[0.9375rem] font-semibold text-ink">Copy an invite link</h4>
        <p className="text-sm text-muted-foreground">
          Anyone with this link can request to join by accepting. It needs sign-in, works once, and expires in{" "}
          {INVITE_TTL_DAYS} days. For another person, create another link.
        </p>
      </div>
      <RoleChoice name="role" />
      {!state.ok ? <FormMessage message={state.message} signedOut={state.signedOut} /> : null}
      <SubmitButton pending={pending} pendingLabel="Creating…" className={cn(secondaryButtonClass, "w-full bg-white text-ink hover:bg-secondary sm:w-auto")}>
        <Link2 className="size-4" aria-hidden="true" /> Create invite link
      </SubmitButton>
    </form>
  );
}

/* --------------------------- created invitation -------------------------- */

function inviteUrl(path: string, appOrigin: string | null) {
  return `${appOrigin ?? window.location.origin}${path}`;
}

function IssuedPanel({ invite, appOrigin, onDismiss }: { invite: IssuedInvite; appOrigin: string | null; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const url = inviteUrl(invite.path, appOrigin);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Invite link copied.");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked (some in-app browsers): select the text so a long-press copies it.
      input.current?.focus();
      input.current?.select();
      toast.error("Couldn’t copy automatically — the link is selected, copy it manually.");
    }
  }

  const status =
    invite.delivery === "sent"
      ? { icon: Check, text: `Email sent to ${invite.email}.`, tone: "text-moss-ink" }
      : invite.delivery === "failed"
        ? { icon: AlertCircle, text: "The email couldn’t be sent. Copy the link and share it yourself.", tone: "text-[#8c2b1f]" }
        : invite.delivery === "not_configured" && invite.email
          ? { icon: Mail, text: "Email delivery is not configured — nothing was sent. Copy the link and share it yourself.", tone: "text-ink" }
          : null;

  return (
    <div role="status" className="space-y-3 rounded-xl border border-moss/40 bg-moss-soft p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[0.9375rem] font-semibold text-ink">
          {invite.email ? `Invitation for ${invite.email}` : "Invite link ready"} · {ROLE_LABELS[invite.role]}
        </p>
        <button type="button" onClick={onDismiss} className="focus-ring -mt-1.5 -mr-2 min-h-11 rounded-lg px-3 text-sm font-semibold text-moss-ink hover:underline">
          Done
        </button>
      </div>
      {status ? (
        <p className={cn("flex items-start gap-2 text-sm", status.tone)}>
          <status.icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {status.text}
        </p>
      ) : null}
      <div className="flex gap-2">
        <input
          ref={input}
          readOnly
          value={url}
          aria-label="Invitation link"
          onFocus={(e) => e.currentTarget.select()}
          className={cn(controlClass, "min-w-0 flex-1 border bg-white font-mono text-[16px] md:text-sm")}
        />
        <button type="button" onClick={copy} className="focus-ring inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-moss-ink px-4 text-[0.9375rem] font-semibold text-white hover:bg-moss-hover">
          {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
          {copied ? "Copied" : "Copy invite link"}
        </button>
      </div>
      <p className="text-sm text-muted-foreground">
        {invite.email ? "Only that email address can accept. " : "Anyone with this link can request to join by accepting. "}
        Works once and expires {formatDay(invite.expiresAt)}. This link is shown only now — if you lose it, use “New link”.
      </p>
    </div>
  );
}

/* ----------------------------- pending invites --------------------------- */

function PendingRow({
  tripId,
  inv,
  emailConfigured,
  onIssued,
}: {
  tripId: string;
  inv: ShareView["invitations"][number];
  emailConfigured: boolean;
  onIssued: (invite: IssuedInvite) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const state = invitationState(inv);
  const expired = state === "expired";

  function replace(sendEmail: boolean) {
    startTransition(async () => {
      const result = await replaceInvitation(tripId, inv.id, sendEmail);
      if (result.ok && result.invite) {
        onIssued(result.invite);
        toast.success(sendEmail && result.invite.delivery === "sent" ? "Invitation sent again." : "New link created. The old one no longer works.");
      } else {
        toast.error(result.message ?? "Couldn’t update the invitation.");
      }
    });
  }

  const delivery =
    inv.email == null
      ? null
      : inv.delivery_status === "sent"
        ? `Email sent ${inv.last_sent_at ? formatDay(inv.last_sent_at) : ""}`.trim()
        : inv.delivery_status === "failed"
          ? "Email failed to send"
          : "Not emailed";

  return (
    <li className="space-y-3 p-3.5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-full bg-surface-warm text-earth-ink">
          {inv.email ? <Mail className="size-4" aria-hidden="true" /> : <Link2 className="size-4" aria-hidden="true" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.9375rem] font-semibold text-ink">{inv.email ?? "Invite link (anyone, once)"}</p>
          <p className="text-sm text-muted-foreground">
            {ROLE_LABELS[inv.role]} ·{" "}
            <span className={cn(expired && "font-semibold text-coral")}>
              <Clock className="mr-0.5 inline size-3.5 align-[-2px]" aria-hidden="true" />
              {expired ? `Expired ${formatDay(inv.expires_at)}` : `Expires ${formatDay(inv.expires_at)}`}
            </span>
            {delivery ? ` · ${delivery}` : ""}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {inv.email && emailConfigured ? (
          <button type="button" disabled={pending} onClick={() => replace(true)} className={cn(secondaryButtonClass, "min-h-11 px-4 text-sm")}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />} Send again
          </button>
        ) : null}
        <button type="button" disabled={pending} onClick={() => replace(false)} className={cn(secondaryButtonClass, "min-h-11 px-4 text-sm")}>
          <Link2 className="size-4" aria-hidden="true" /> New link
        </button>
        <button type="button" disabled={pending} onClick={() => setConfirming(true)} className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-destructive hover:bg-[#fff1ee]">
          <Trash2 className="size-4" aria-hidden="true" /> Revoke
        </button>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Revoke this invitation?"
        description="Its link will stop working right away. You can create a new invitation any time."
        confirmLabel="Revoke invitation"
        pendingLabel="Revoking…"
        cancelLabel="Keep it"
        onConfirm={async () => {
          const result = await revokeInvitation(tripId, inv.id);
          if (result.ok) {
            toast.success(result.message ?? "Invitation revoked.");
            setConfirming(false);
          } else toast.error(result.message ?? "Couldn’t revoke the invitation.");
        }}
      />
    </li>
  );
}

/* -------------------------------- members -------------------------------- */

function MemberRow({ tripId, member }: { tripId: string; member: ShareView["members"][number] }) {
  const [pending, startTransition] = useTransition();
  const [role, setRole] = useState<InviteRole>(member.role);
  const [confirming, setConfirming] = useState(false);
  const selectId = useId();

  function change(next: InviteRole) {
    const previous = role;
    setRole(next);
    startTransition(async () => {
      const result = await changeMemberRole(tripId, member.user_id, next);
      if (result.ok) toast.success(`${member.name} is now ${ROLE_LABELS[next] === "Editor" ? "an Editor" : "a Viewer"}.`);
      else {
        setRole(previous);
        toast.error(result.message ?? "Couldn’t change the role.");
      }
    });
  }

  return (
    <li className="space-y-3 p-3.5">
      <div className="flex items-center gap-3">
        <UserAvatar name={member.name} initials={initialsOf(member.name)} className="size-10" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.9375rem] font-semibold text-ink">{member.name}</p>
          {member.email ? <p className="truncate text-sm text-muted-foreground">{member.email}</p> : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={selectId} className="sr-only">
          Role for {member.name}
        </label>
        <select
          id={selectId}
          value={role}
          disabled={pending}
          onChange={(e) => change(e.target.value as InviteRole)}
          className={cn(controlClass, "w-auto min-w-36 border py-0 pr-8")}
        >
          {INVITE_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => setConfirming(true)} className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-destructive hover:bg-[#fff1ee]">
          <UserMinus className="size-4" aria-hidden="true" /> Remove
        </button>
      </div>
      <p className="text-sm text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</p>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Remove ${member.name}?`}
        description="They lose access to this trip right away. Anything they added stays on the trip."
        confirmLabel="Remove from trip"
        pendingLabel="Removing…"
        cancelLabel="Keep them"
        onConfirm={async () => {
          const result = await removeMember(tripId, member.user_id);
          if (result.ok) {
            toast.success(result.message ?? "Removed.");
            setConfirming(false);
          } else toast.error(result.message ?? "Couldn’t remove them.");
        }}
      />
    </li>
  );
}

/* ----------------------------- non-owner view ---------------------------- */

function MemberPanel({ tripId, view }: { tripId: string; view: ShareView }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <ul className="divide-y divide-border rounded-xl border border-border bg-white">
        <li className="flex items-center gap-3 p-3.5">
          <UserAvatar name={view.owner.name} initials={initialsOf(view.owner.name)} className="size-10" />
          <p className="min-w-0 flex-1 truncate text-[0.9375rem] font-semibold text-ink">{view.owner.name}</p>
          <span className="rounded-full bg-gold-soft px-2.5 py-1 text-xs font-semibold text-gold-ink">Owner</span>
        </li>
        {view.members.map((m) => (
          <li key={m.user_id} className="flex items-center gap-3 p-3.5">
            <UserAvatar name={m.name} initials={initialsOf(m.name)} className="size-10" />
            <p className="min-w-0 flex-1 truncate text-[0.9375rem] font-semibold text-ink">
              {m.name}
              {m.isYou ? " (you)" : ""}
            </p>
            <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-secondary-foreground">{ROLE_LABELS[m.role]}</span>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted-foreground">
        Your access: <strong className="font-semibold text-ink">{ROLE_LABELS[view.role]}</strong> — {ROLE_DESCRIPTIONS[view.role]}
      </p>
      <button type="button" onClick={() => setConfirming(true)} className={cn(secondaryButtonClass, "text-destructive")}>
        <UserMinus className="size-4" aria-hidden="true" /> Leave this trip
      </button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Leave this trip?"
        description="You’ll lose access. The owner can invite you again. Anything you added stays on the trip, and your private Explore favorites and notes are removed."
        confirmLabel="Leave trip"
        pendingLabel="Leaving…"
        cancelLabel="Stay"
        onConfirm={async () => {
          const result = await leaveTrip(tripId);
          // On success the action redirects; we only get here on failure.
          if (!result.ok) toast.error(result.message ?? "Couldn’t leave the trip.");
        }}
      />
    </>
  );
}
