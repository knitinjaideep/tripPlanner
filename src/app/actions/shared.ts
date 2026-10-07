import "server-only";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { AuthRequiredError, ForbiddenError, getRowChangeForUser, type ChangeKind } from "@/lib/dal";
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
    if (error instanceof ForbiddenError) return { ok: false, forbidden: true, message: error.message };
    const pg = error as { code?: string; cause?: { code?: string } };
    console.error(`[rove] ${context} failed:`, pg.cause?.code ?? pg.code ?? (error as Error)?.name);
    return { ok: false, message: "Something went wrong saving that. Nothing was changed — please try again." };
  }
}

/**
 * Someone else saved this record after the form was opened. Nothing was
 * overwritten; the form keeps the draft and can deliberately save over the
 * newer version using `latestUpdatedAt`.
 */
export async function conflictState(tripId: string, kind: ChangeKind, id: string, what: string): Promise<ActionState> {
  const latest = await getRowChangeForUser(tripId, kind, id);
  const who = latest?.by ? latest.by : "Someone else";
  return {
    ok: false,
    conflict: { latestUpdatedAt: latest?.updatedAt ?? null },
    message: `${who} changed this ${what} while you were editing. Your changes haven’t been saved and are still here.`,
  };
}
