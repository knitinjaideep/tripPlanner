"use client";

import { useActionState, useTransition, type FormEvent } from "react";
import type { ActionState } from "@/lib/types";

/**
 * useActionState wired through onSubmit so React does not reset the form
 * after the action — invalid, failed or conflicting submissions keep what the
 * traveler typed. `pending` also blocks a second submit while one is in flight.
 */
export function useFormAction<S extends ActionState = ActionState>(
  action: (prev: S, formData: FormData) => Promise<S>,
) {
  const [state, formAction, actionPending] = useActionState(
    action as unknown as (prev: ActionState, formData: FormData) => Promise<ActionState>,
    { ok: false } as ActionState,
  );
  const [transitionPending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (actionPending || transitionPending) return;
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  return { state: state as S, onSubmit, pending: actionPending || transitionPending };
}
