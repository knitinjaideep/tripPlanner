"use client";

import { useTransition } from "react";
import { Check, Loader2, LogOut } from "lucide-react";
import { acceptInvitation, type AcceptState } from "@/app/actions/sharing";
import { switchAccountForInvite } from "@/app/actions/auth";
import { FormMessage, SubmitButton, secondaryButtonClass } from "@/components/forms/fields";
import { useFormAction } from "@/components/forms/use-form-action";

/** The explicit step. Signing in never reaches this — only this button joins the trip. */
export function AcceptInvitationForm({ token }: { token: string }) {
  const { state, onSubmit, pending } = useFormAction<AcceptState>(acceptInvitation.bind(null, token));
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {!state.ok ? <FormMessage message={state.message} signedOut={state.signedOut} /> : null}
      <SubmitButton pending={pending} pendingLabel="Joining the trip…" className="h-13 w-full text-base">
        <Check className="size-5" aria-hidden="true" /> Accept invitation
      </SubmitButton>
    </form>
  );
}

/** Sign out, then come back to this invitation after signing in with another account. */
export function SwitchAccountButton({ token, label = "Use a different account" }: { token: string; label?: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-busy={pending}
      onClick={() => startTransition(() => switchAccountForInvite(token))}
      className={`${secondaryButtonClass} w-full`}
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <LogOut className="size-4" aria-hidden="true" />}
      {pending ? "Signing out…" : label}
    </button>
  );
}
