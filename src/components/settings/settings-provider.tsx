"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { refreshAppearance, saveAppearance } from "@/app/actions/settings";
import { BackgroundLayer } from "@/components/appearance/background-layer";
import {
  appearanceReducer,
  effectiveOf,
  initialAppearanceState,
  isDirty,
  isLocked,
  saveBasis,
  type AppearanceState,
  type SavePhase,
} from "@/lib/appearance-state";
import {
  defaultAppearance,
  effectiveAppearance,
  type Appearance,
  type BackgroundId,
  type DisplayPreferences,
} from "@/lib/settings";

/**
 * The one place the app shell learns how it should look.
 *
 *  - `saved`     what the server has stored for the signed-in person (the last server-confirmed value).
 *  - `draft`     unsaved choices from Settings → Appearance (null = none). Memory only: it survives
 *                client-side navigation (this provider lives in the signed-in layout, which never
 *                remounts between pages) but a refresh or closed tab discards it. Nothing is written
 *                anywhere until Save.
 *  - `effective` what the shell actually paints: the draft when there is one, otherwise the saved
 *                value, with a missing background picture falling back to Plain Ivory.
 *
 * The state transitions live in src/lib/appearance-state.ts (pure, tested). This component adds the
 * side effects: the server save, focus refresh, the unsaved-changes warning and the background layer.
 *
 * It is keyed by the signed-in user in the layout, so an account switch drops any draft and starts
 * from the new account's server-read values.
 */
export type AppearanceController = {
  saved: Appearance;
  draft: Appearance | null;
  /** The appearance being painted (draft ?? saved, with unavailable backgrounds resolved to Plain Ivory). */
  effective: Appearance;
  available: readonly BackgroundId[];
  /** True while the app is showing choices that have not been saved. */
  previewing: boolean;
  /** Editing is refused while a save is in flight. */
  locked: boolean;
  phase: SavePhase;
  message: string | null;
  /** Whether the person has ever saved an appearance (false = Atlas's default). */
  everSaved: boolean;
  /** A newer appearance saved on another device while a draft was active. */
  remote: Appearance | null;
  /** The background that failed to load (shown as Plain Ivory instead), if it is the one being painted. */
  imageError: BackgroundId | null;
  edit: (patch: Partial<Appearance>) => void;
  restoreDefaults: () => void;
  cancel: () => void;
  save: () => Promise<void>;
  retryImage: () => void;
  dismissImageError: () => void;
};

type Ctx = AppearanceController & { display: DisplayPreferences; commitDisplay: (display: DisplayPreferences) => void };

const SettingsContext = createContext<Ctx | null>(null);

const REFRESH_MIN_MS = 20_000;

export function SettingsProvider({
  initialAppearance,
  initialAppearanceVersion,
  initialAppearanceSaved,
  initialDisplay,
  available,
  children,
}: {
  initialAppearance: Appearance;
  initialAppearanceVersion: number;
  initialAppearanceSaved: boolean;
  initialDisplay: DisplayPreferences;
  available: readonly BackgroundId[];
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(appearanceReducer, undefined, () =>
    initialAppearanceState(initialAppearance, initialAppearanceVersion, initialAppearanceSaved),
  );
  const stateRef = useRef<AppearanceState>(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const [display, setDisplay] = useState(initialDisplay);
  const [imageFailure, setImageFailure] = useState<{ id: BackgroundId } | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  // A fresh server render (a full reload keeps no state; a revalidation can bring newer values) is a
  // "remote" update: adopted when nothing is unsaved, parked for review when there is a draft.
  const [seenDisplay, setSeenDisplay] = useState(initialDisplay);
  if (JSON.stringify(seenDisplay) !== JSON.stringify(initialDisplay)) {
    setSeenDisplay(initialDisplay);
    setDisplay(initialDisplay);
  }
  useEffect(() => {
    dispatch({ type: "remote", appearance: initialAppearance, version: initialAppearanceVersion });
  }, [initialAppearance, initialAppearanceVersion]);

  const effective = useMemo(() => effectiveAppearance(effectiveOf(state), available), [state, available]);
  const previewing = isDirty(state);
  const locked = isLocked(state);

  const edit = useCallback((patch: Partial<Appearance>) => dispatch({ type: "edit", patch }), []);
  const restoreDefaults = useCallback(() => dispatch({ type: "replace", next: defaultAppearance(available) }), [available]);
  const cancel = useCallback(() => dispatch({ type: "cancel" }), []);

  const save = useCallback(async () => {
    const s = stateRef.current;
    if (isLocked(s) || !isDirty(s)) return;
    const { version, patch } = saveBasis(s);
    if (Object.keys(patch).length === 0) {
      // The preview already matches what another device saved: take that and clear the draft.
      dispatch({ type: "accept-remote" });
      return;
    }
    dispatch({ type: "save-start" });
    try {
      const result = await saveAppearance(patch, version);
      if (result.ok && result.appearance && result.version !== undefined) {
        dispatch({ type: "save-ok", appearance: result.appearance, version: result.version });
      } else if (result.conflict && result.appearance && result.version !== undefined) {
        dispatch({ type: "save-conflict", appearance: result.appearance, version: result.version, message: result.message ?? "Your appearance was changed on another device." });
      } else {
        dispatch({ type: "save-failed", message: result.message ?? "That didn’t save. Your preview is still here — try again, or Cancel." });
      }
    } catch {
      dispatch({ type: "save-failed", message: "We couldn’t reach Atlas, so nothing was saved. Your preview is still here — check your connection and try again." });
    }
  }, []);

  // "Appearance saved" is a passing confirmation.
  useEffect(() => {
    if (state.phase !== "saved") return;
    const t = window.setTimeout(() => dispatch({ type: "dismiss-status" }), 4000);
    return () => window.clearTimeout(t);
  }, [state.phase]);

  // Other devices: when this tab comes back into view, ask what is saved. An unsaved draft is never replaced.
  useEffect(() => {
    let last = Date.now();
    const check = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < REFRESH_MIN_MS || isLocked(stateRef.current)) return;
      last = Date.now();
      void refreshAppearance().then((r) => {
        if (r.ok && r.appearance && r.version !== undefined) dispatch({ type: "remote", appearance: r.appearance, version: r.version });
      });
    };
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, []);

  // An unsaved preview is lost on refresh or close: ask first where the browser supports it.
  useEffect(() => {
    if (!previewing) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [previewing]);

  const commitDisplay = useCallback((next: DisplayPreferences) => setDisplay(next), []);
  const onImageFailed = useCallback((id: BackgroundId) => setImageFailure({ id }), []);
  const retryImage = useCallback(() => {
    setImageFailure(null);
    setRetryNonce((n) => n + 1);
  }, []);
  const dismissImageError = useCallback(() => setImageFailure(null), []);
  // The failure only matters while that picture is the one being asked for.
  const imageError = imageFailure && imageFailure.id === effective.background ? imageFailure.id : null;

  const value = useMemo<Ctx>(
    () => ({
      saved: state.saved,
      draft: state.draft,
      effective,
      available,
      previewing,
      locked,
      phase: state.phase,
      message: state.message,
      everSaved: state.everSaved,
      remote: state.remote?.appearance ?? null,
      imageError,
      edit,
      restoreDefaults,
      cancel,
      save,
      retryImage,
      dismissImageError,
      display,
      commitDisplay,
    }),
    [state, effective, available, previewing, locked, imageError, edit, restoreDefaults, cancel, save, retryImage, dismissImageError, display, commitDisplay],
  );

  return (
    <SettingsContext.Provider value={value}>
      {/* Density and the mascot switch act on the whole document (portals such as dialogs included). */}
      <style>{`${effective.density === "compact" ? "@media (pointer: fine){:root{--spacing:0.215rem}}" : ""}${effective.mascot === "hide" ? "[data-atlas-mascot]{display:none!important}" : ""}`}</style>
      <div
        data-appearance-root=""
        data-bg={effective.background}
        data-intensity={effective.intensity}
        data-density={effective.density}
        data-mascot={effective.mascot}
        className="relative isolate flex min-h-full flex-1 flex-col *:min-w-0"
      >
        <BackgroundLayer background={effective.background} intensity={effective.intensity} retryNonce={retryNonce} onFailed={onImageFailed} />
        {children}
      </div>
    </SettingsContext.Provider>
  );
}

function useSettingsContext(): Ctx {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("Settings hooks must be used inside the signed-in app layout.");
  return ctx;
}

/** Saved / draft / effective appearance and the actions Settings and the preview bar use. */
export const useAppearance = (): AppearanceController => useSettingsContext();

/** The person's display preferences (clock, distance unit, currency). Presentation only. */
export function useDisplayPrefs(): DisplayPreferences {
  return useSettingsContext().display;
}

export const useCommitDisplay = () => useSettingsContext().commitDisplay;
