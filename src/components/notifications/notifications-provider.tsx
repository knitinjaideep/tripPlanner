"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/** How often a visible tab asks whether anything new arrived. Hidden tabs don't poll. */
const POLL_MS = 60_000;

type Summary = { unread: number; latest: string | null };

type Value = {
  unread: number;
  /** Bumps whenever the server's summary changed (new item, or a read elsewhere) — open lists refetch on it. */
  revision: number;
  /** For sr-only announcements: set when the count went up after a poll. */
  announcement: string;
  timeZone: string | null;
  /** Apply a local change right away (optimistic), then reconcile with the server. */
  adjustUnread: (delta: number) => void;
  setUnread: (count: number) => void;
  refresh: () => Promise<void>;
};

const Context = createContext<Value | null>(null);

export function useNotificationsContext() {
  const value = useContext(Context);
  if (!value) throw new Error("NotificationsProvider is missing");
  return value;
}

/**
 * Holds the bell's unread count for the whole signed-in app and keeps it
 * current across devices without a socket service: a small authorized GET
 * every minute while the tab is visible, an immediate check when the tab
 * regains focus / visibility or the network returns, and nothing at all
 * while the tab is hidden. Stops for good if the session has ended.
 */
export function NotificationsProvider({
  initial,
  timeZone,
  children,
}: {
  initial: Summary;
  timeZone: string | null;
  children: ReactNode;
}) {
  const [unread, setUnreadState] = useState(initial.unread);
  const [revision, setRevision] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const known = useRef<Summary>(initial);
  const stopped = useRef(false);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (stopped.current || inFlight.current) return;
    inFlight.current = true;
    try {
      const response = await fetch("/api/notifications/summary", { cache: "no-store", credentials: "same-origin" });
      // Signed out: the API answers 401, or the sign-in proxy redirects to the login page. Either way, stop asking.
      if (response.status === 401 || response.redirected) {
        stopped.current = true;
        return;
      }
      if (!response.ok) return;
      const next = (await response.json()) as Summary;
      const before = known.current;
      known.current = next;
      setUnreadState(next.unread);
      if (next.unread !== before.unread || next.latest !== before.latest) {
        setRevision((r) => r + 1);
        if (next.unread > before.unread) {
          setAnnouncement(next.unread === 1 ? "You have 1 unread notification." : `You have ${next.unread} unread notifications.`);
        }
      }
    } catch {
      // Offline or a blip: keep what we have; the next tick or focus tries again.
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    const visible = () => document.visibilityState === "visible";
    const tick = () => {
      if (visible()) void refresh();
    };
    const timer = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    window.addEventListener("online", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
      window.removeEventListener("online", tick);
    };
  }, [refresh]);

  const setUnread = useCallback((count: number) => {
    known.current = { ...known.current, unread: count };
    setUnreadState(count);
  }, []);
  const adjustUnread = useCallback((delta: number) => {
    setUnreadState((n) => {
      const next = Math.max(0, n + delta);
      known.current = { ...known.current, unread: next };
      return next;
    });
  }, []);

  const value = useMemo<Value>(
    () => ({ unread, revision, announcement, timeZone, adjustUnread, setUnread, refresh }),
    [unread, revision, announcement, timeZone, adjustUnread, setUnread, refresh],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
