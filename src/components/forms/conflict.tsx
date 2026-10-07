"use client";

import { flushSync } from "react-dom";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { GitMerge } from "lucide-react";
import { secondaryButtonClass } from "@/components/forms/fields";
import type { ActionState } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Edit-conflict protection for a form that edits an existing record.
 *
 * Renders (a) a hidden `expected_updated_at` — the version this form was
 * opened from — which the server checks before saving, and (b) when the
 * server says someone else saved first, a notice that keeps the draft where
 * it is and offers two clear choices: deliberately save over their version, or
 * drop the draft and reload. Nothing is overwritten silently.
 */
export function ConflictGuard({
  state,
  expectedUpdatedAt,
  onDiscard,
}: {
  state: ActionState;
  expectedUpdatedAt?: string | null;
  onDiscard: () => void;
}) {
  const router = useRouter();
  const [override, setOverride] = useState<string | null>(null);
  const token = override ?? expectedUpdatedAt ?? "";
  const latest = state.conflict?.latestUpdatedAt ?? null;

  return (
    <>
      {token ? <input type="hidden" name="expected_updated_at" value={token} /> : null}
      {state.conflict ? (
        <div role="alert" className="space-y-3 rounded-xl border border-gold/70 bg-gold-soft/60 p-4 text-sm text-ink">
          <p className="flex items-start gap-2.5">
            <GitMerge className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              {state.message} Choose what to do — your text is still in the form.
            </span>
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={!latest}
              onClick={(event) => {
                const form = event.currentTarget.form;
                // Re-render with the newer version's token first, then save.
                flushSync(() => setOverride(latest));
                form?.requestSubmit();
              }}
              className="focus-ring inline-flex min-h-11 items-center justify-center rounded-xl bg-moss-ink px-4 text-sm font-semibold text-white hover:bg-moss-hover disabled:opacity-60"
            >
              Save my version anyway
            </button>
            <button
              type="button"
              onClick={() => {
                onDiscard();
                router.refresh();
              }}
              className={cn(secondaryButtonClass, "min-h-11 px-4 text-sm")}
            >
              Discard mine and see theirs
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
