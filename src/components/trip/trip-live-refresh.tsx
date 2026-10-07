"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, WifiOff } from "lucide-react";

/** How often an open, visible tab asks whether anyone changed the trip. Hidden tabs don't poll. */
const POLL_MS = 20_000;

/** True while a dialog / sheet is open or a field is being edited — a refresh must not disturb that. */
function userIsBusy() {
  if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return true;
  const el = document.activeElement;
  return (
    el instanceof HTMLElement &&
    (el.isContentEditable || (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && Boolean(el.closest("form"))))
  );
}

/**
 * Keeps an open trip current when other members change it, without a manual
 * reload and without a socket service:
 *
 * - polls a tiny authorized endpoint (an opaque change fingerprint) every 20 s
 *   while the tab is visible, and checks right away when the tab regains
 *   focus, becomes visible or the network returns;
 * - on a change it calls `router.refresh()`, which re-renders the server data
 *   but keeps client state, so nothing typed into a form is lost — and if a
 *   dialog or field is in use it waits and offers a "Refresh" button instead;
 * - tells the truth when offline, and stops when access was removed.
 */
export function TripLiveRefresh({ tripId, version }: { tripId: string; version: string }) {
  const router = useRouter();
  const known = useRef(version);
  const stopped = useRef(false);
  const [stale, setStale] = useState(false);
  const [offline, setOffline] = useState(false);

  // Every server render (including one caused by our own save) brings the current version.
  useEffect(() => {
    known.current = version;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the banner when fresh data arrives
    setStale(false);
  }, [version]);

  const refreshNow = useCallback(() => {
    setStale(false);
    router.refresh();
  }, [router]);

  const check = useCallback(async () => {
    if (stopped.current || document.visibilityState !== "visible") return;
    try {
      const response = await fetch(`/api/trips/${tripId}/version`, { cache: "no-store", credentials: "same-origin" });
      setOffline(false);
      if (response.status === 404 || response.status === 401) {
        // Access removed (or signed out): stop polling and let the server render decide what to show.
        stopped.current = true;
        router.refresh();
        return;
      }
      if (!response.ok) return;
      const body = (await response.json()) as { version?: string };
      if (body.version && body.version !== known.current) {
        if (userIsBusy()) setStale(true);
        else refreshNow();
      }
    } catch {
      setOffline(true);
    }
  }, [tripId, router, refreshNow]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      // A deferred update applies itself once the dialog is closed.
      if (document.visibilityState === "visible") void check();
    }, POLL_MS);
    const onVisible = () => void check();
    const onOnline = () => {
      setOffline(false);
      void check();
    };
    const onOffline = () => setOffline(true);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    if (!navigator.onLine) onOffline();
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [check]);

  if (!offline && !stale) return null;
  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 pt-3 sm:px-6 lg:px-8">
      {offline ? (
        <p role="status" className="flex items-start gap-2.5 rounded-xl border border-gold/60 bg-gold-soft/60 p-3 text-sm text-ink">
          <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            You’re offline. You’re seeing the trip as it was last loaded, and changes can’t be saved until you’re back
            online.
          </span>
        </p>
      ) : (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-moss/40 bg-moss-soft p-3 text-sm text-ink">
          <RefreshCw className="size-4 shrink-0 text-moss-ink" aria-hidden="true" />
          <span className="min-w-0 flex-1">Someone updated this trip. Finish what you’re doing, then refresh.</span>
          <button
            type="button"
            onClick={refreshNow}
            className="focus-ring min-h-11 rounded-xl bg-moss-ink px-4 text-sm font-semibold text-white hover:bg-moss-hover"
          >
            Refresh now
          </button>
        </div>
      )}
    </div>
  );
}
