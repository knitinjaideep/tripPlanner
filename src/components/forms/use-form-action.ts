"use client";

import { useActionState, useTransition, type FormEvent } from "react";
import type { ActionState } from "@/lib/types";

const INITIAL: ActionState = { ok: false };

/**
 * useActionState wired through onSubmit so React does not reset the form
 * after the action — invalid submissions keep what the traveler typed.
 */
export function useFormAction(
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>,
) {
  const [state, formAction, actionPending] = useActionState(action, INITIAL);
  const [transitionPending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  return { state, onSubmit, pending: actionPending || transitionPending };
}
