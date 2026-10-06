"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const COOKIE = "rove-tz";

/**
 * Tells the server the viewer's time zone so "today", countdowns and trip
 * grouping match the traveler's calendar rather than the server's.
 */
export function TimeZoneSync() {
  const router = useRouter();

  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const current = document.cookie
      .split("; ")
      .find((c) => c.startsWith(`${COOKIE}=`))
      ?.split("=")[1];
    if (tz && decodeURIComponent(current ?? "") !== tz) {
      // Host-only (no Domain), Secure on https; plain http stays usable for local dev.
      const secure = window.location.protocol === "https:" ? "; secure" : "";
      document.cookie = `${COOKIE}=${encodeURIComponent(tz)}; path=/; max-age=31536000; samesite=lax${secure}`;
      router.refresh();
    }
  }, [router]);

  return null;
}
