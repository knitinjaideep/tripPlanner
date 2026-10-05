import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/types";

export function invalid(error: z.ZodError): ActionState {
  return {
    ok: false,
    message: "Please check the highlighted fields.",
    fieldErrors: z.flattenError(error).fieldErrors as ActionState["fieldErrors"],
  };
}

export function failed(context: string, error: { message: string; code?: string }): ActionState {
  // Log details server-side only; show the user a calm, generic message.
  console.error(`[rove] ${context}:`, error.code, error.message);
  return { ok: false, message: "Something went wrong saving that. Please try again." };
}

/** A Supabase client for a verified user, or null when signed out. */
export async function authedClient() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) return null;
  return supabase;
}

export const SIGNED_OUT: ActionState = {
  ok: false,
  message: "Your session has ended. Please sign in again.",
};
