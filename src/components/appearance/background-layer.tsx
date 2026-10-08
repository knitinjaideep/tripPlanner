"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { BACKGROUND_REGISTRY, type BackgroundId } from "@/lib/backgrounds";
import { preloadBackground } from "@/lib/background-preload";
import type { Intensity } from "@/lib/settings";

/**
 * The single, decorative background layer behind the whole signed-in app.
 *
 * Paint order (bottom → top): ivory base colour → the picture → an ivory wash
 * whose opacity comes from the registry (subtle washes more than standard).
 * Opacity is never applied to the app itself, only to the wash.
 *
 * A newly chosen picture is loaded first; the current one stays visible until
 * it is ready, the latest choice always wins, and a picture that fails shows
 * Plain Ivory and reports the failure (it never touches saved settings).
 */
export function BackgroundLayer({
  background,
  intensity,
  retryNonce,
  onFailed,
}: {
  background: BackgroundId;
  intensity: Intensity;
  /** Bumped by "Try again" to re-request a picture that failed. */
  retryNonce: number;
  onFailed: (id: BackgroundId) => void;
}) {
  // Start on the requested picture: the server already rendered it, so the first paint has no flash.
  const [view, setView] = useState<{ shown: BackgroundId; leaving: BackgroundId | null }>({ shown: background, leaving: null });
  const latest = useRef(0);

  useEffect(() => {
    const ticket = ++latest.current;
    const show = (id: BackgroundId) => setView((v) => (v.shown === id ? v : { shown: id, leaving: v.shown }));
    if (BACKGROUND_REGISTRY[background].url === null) {
      show(background);
      return;
    }
    void preloadBackground(background).then((ok) => {
      // A newer choice was made while this picture loaded: ignore this result.
      if (ticket !== latest.current) return;
      if (ok) show(background);
      else {
        show("plain-ivory");
        onFailed(background);
      }
    });
  }, [background, retryNonce, onFailed]);

  // The outgoing picture only needs to stay under the incoming fade.
  useEffect(() => {
    if (!view.leaving) return;
    const t = window.setTimeout(() => setView((v) => ({ ...v, leaving: null })), 400);
    return () => window.clearTimeout(t);
  }, [view]);

  const entry = BACKGROUND_REGISTRY[view.shown];
  const out = view.leaving ? BACKGROUND_REGISTRY[view.leaving] : null;
  const style = {
    backgroundColor: entry.baseColor,
    "--bg-pos": entry.position.wide,
    "--bg-pos-narrow": entry.position.narrow,
    "--bg-wash": entry.overlay[intensity],
  } as CSSProperties;

  return (
    <div aria-hidden="true" inert className="atlas-bg" style={style}>
      {out?.url ? (
        <div
          className="atlas-bg-img"
          style={{ backgroundImage: `url(${out.url})`, "--bg-pos": out.position.wide, "--bg-pos-narrow": out.position.narrow } as CSSProperties}
        />
      ) : null}
      {entry.url ? <div key={view.shown} className="atlas-bg-img atlas-bg-in" style={{ backgroundImage: `url(${entry.url})` }} /> : null}
      <div className="atlas-bg-wash" />
    </div>
  );
}
