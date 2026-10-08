import { sameAppearance, type Appearance } from "@/lib/settings";

/**
 * The appearance state machine, kept pure so it can be tested without a
 * browser. The provider (settings-provider.tsx) runs it with useReducer.
 *
 *   saved      last server-confirmed appearance (+ its `version`)
 *   draft      the unsaved preview, or null. Never persisted anywhere.
 *   effective  draft ?? saved  — what the whole app paints (selector below)
 *
 * Invariants
 *  - `draft` is null whenever it equals `saved` ("nothing unsaved").
 *  - Editing is refused while a save is in flight (`phase === "saving"`), so a
 *    completed save can never discard a newer choice; success additionally only
 *    clears a draft that still equals what was submitted.
 *  - A failed save, or a conflict with another device, keeps the draft.
 *  - A remote (newer) saved appearance never replaces an active draft; it is
 *    parked in `remote` for the person to review.
 */

export type SavePhase = "idle" | "saving" | "saved" | "error" | "conflict";

export type AppearanceState = {
  saved: Appearance;
  /** Server version of `saved` (0 = never saved). Sent with the next save. */
  version: number;
  /** Whether the person has ever saved an appearance (false = showing Atlas's default). */
  everSaved: boolean;
  draft: Appearance | null;
  phase: SavePhase;
  message: string | null;
  /** What was sent while saving; only that exact draft is cleared by its own success. */
  submitted: Appearance | null;
  /** A newer saved appearance from another device, seen while a draft was active. */
  remote: { appearance: Appearance; version: number } | null;
};

export type AppearanceAction =
  | { type: "edit"; patch: Partial<Appearance> }
  | { type: "replace"; next: Appearance }
  | { type: "cancel" }
  | { type: "save-start" }
  | { type: "save-ok"; appearance: Appearance; version: number }
  | { type: "save-failed"; message: string }
  | { type: "save-conflict"; appearance: Appearance; version: number; message: string }
  | { type: "remote"; appearance: Appearance; version: number }
  | { type: "accept-remote" }
  | { type: "dismiss-status" };

export const initialAppearanceState = (saved: Appearance, version: number, everSaved: boolean): AppearanceState => ({
  saved,
  version,
  everSaved,
  draft: null,
  phase: "idle",
  message: null,
  submitted: null,
  remote: null,
});

export const effectiveOf = (s: AppearanceState): Appearance => s.draft ?? s.saved;
export const isDirty = (s: AppearanceState): boolean => s.draft !== null && !sameAppearance(s.draft, s.saved);
export const isLocked = (s: AppearanceState): boolean => s.phase === "saving";
/** The fields that differ from saved: the only thing a save ever sends. */
export function changedFields(saved: Appearance, draft: Appearance): Partial<Appearance> {
  const patch: Partial<Appearance> = {};
  for (const key of Object.keys(draft) as (keyof Appearance)[]) if (draft[key] !== saved[key]) (patch as Record<string, string>)[key] = draft[key];
  return patch;
}

/** What a save starts from: a parked newer remote appearance is the base when the person chooses to save over it. */
export function saveBasis(s: AppearanceState): { base: Appearance; version: number; patch: Partial<Appearance> } {
  const base = s.remote?.appearance ?? s.saved;
  return { base, version: s.remote?.version ?? s.version, patch: s.draft ? changedFields(base, s.draft) : {} };
}

const withDraft = (s: AppearanceState, next: Appearance): AppearanceState => ({
  ...s,
  draft: sameAppearance(next, s.saved) ? null : next,
  // A new choice clears a stale "Saved" / error line, but keeps a pending conflict explanation.
  phase: s.phase === "conflict" ? "conflict" : "idle",
  message: s.phase === "conflict" ? s.message : null,
});

export function appearanceReducer(s: AppearanceState, a: AppearanceAction): AppearanceState {
  switch (a.type) {
    case "edit":
      if (isLocked(s)) return s;
      return withDraft(s, { ...effectiveOf(s), ...a.patch });
    case "replace":
      if (isLocked(s)) return s;
      return withDraft(s, a.next);
    case "cancel": {
      if (isLocked(s)) return s;
      // Cancelling while another device's newer choice is parked means "use theirs".
      const base = s.remote ? { ...s, saved: s.remote.appearance, version: s.remote.version, everSaved: true } : s;
      return { ...base, draft: null, phase: "idle", message: null, submitted: null, remote: null };
    }
    case "save-start":
      if (isLocked(s) || !isDirty(s)) return s;
      // Saving over a parked remote choice is deliberate: rebase onto its version first.
      return {
        ...(s.remote ? { ...s, saved: s.remote.appearance, version: s.remote.version, everSaved: true, remote: null } : s),
        phase: "saving",
        message: null,
        submitted: s.draft,
      };
    case "save-ok": {
      const stillSubmitted = s.draft !== null && s.submitted !== null && sameAppearance(s.draft, s.submitted);
      const draft = stillSubmitted || s.draft === null || sameAppearance(s.draft, a.appearance) ? null : s.draft;
      return { ...s, saved: a.appearance, version: a.version, everSaved: true, draft, phase: "saved", message: "Appearance saved.", submitted: null, remote: null };
    }
    case "save-failed":
      return { ...s, phase: "error", message: a.message, submitted: null };
    case "save-conflict":
      if (s.draft && sameAppearance(s.draft, a.appearance)) {
        // The other device saved exactly this preview: nothing is left to decide.
        return { ...s, saved: a.appearance, version: a.version, everSaved: true, draft: null, phase: "saved", message: "Appearance saved.", submitted: null, remote: null };
      }
      return {
        ...s,
        phase: "conflict",
        message: a.message,
        submitted: null,
        // If the other device's choice is exactly the preview, there is nothing left to decide.
        remote: { appearance: a.appearance, version: a.version },
      };
    case "remote": {
      if (a.version <= s.version) return s;
      if (isLocked(s)) return s;
      if (s.draft === null) return { ...s, saved: a.appearance, version: a.version, everSaved: true, remote: null };
      return { ...s, remote: { appearance: a.appearance, version: a.version } };
    }
    case "accept-remote":
      return s.remote ? { ...s, saved: s.remote.appearance, version: s.remote.version, everSaved: true, remote: null, phase: "idle", message: null, draft: s.draft && sameAppearance(s.draft, s.remote.appearance) ? null : s.draft } : s;
    case "dismiss-status":
      return s.phase === "saved" ? { ...s, phase: "idle", message: null } : s;
  }
}
