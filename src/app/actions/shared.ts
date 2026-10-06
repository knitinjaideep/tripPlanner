import "server-only";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { AuthRequiredError } from "@/lib/dal";
import { SessionUnavailableError } from "@/lib/user";
import type { ActionState } from "@/lib/types";

export function invalid(error: z.ZodError): ActionState {
  return {
    ok: false,
    message: "Please check the highlighted fields.",
    fieldErrors: z.flattenError(error).fieldErrors as ActionState["fieldErrors"],
  };
}

export const SIGNED_OUT: ActionState = {
  ok: false,
  signedOut: true,
  message: "Your session has ended. Sign in again to save — your changes are still here.",
};

export const notFound = (what: string): ActionState => ({ ok: false, message: `${what} not found.` });

/**
 * Run a mutation and turn failures into a calm ActionState. Redirects and
 * other Next.js control flow are re-thrown. Details are logged server-side
 * only (no SQL, credentials or tokens reach the browser).
 */
export async function guarded(context: string, run: () => Promise<ActionState>): Promise<ActionState> {
  try {
    return await run();
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof AuthRequiredError) return SIGNED_OUT;
    if (error instanceof SessionUnavailableError) return { ok: false, message: error.message };
    const pg = error as { code?: string; cause?: { code?: string } };
    console.error(`[rove] ${context} failed:`, pg.cause?.code ?? pg.code ?? (error as Error)?.name);
    return { ok: false, message: "Something went wrong saving that. Nothing was changed — please try again." };
  }
}
