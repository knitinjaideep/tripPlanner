import "server-only";
import { cookies } from "next/headers";

export const TZ_COOKIE = "rove-tz";

function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * The viewer's IANA time zone, reported by the browser (TimeZoneSync) into a
 * cookie. Falls back to the server's zone on the very first request.
 */
export async function getViewerTimeZone() {
  const tz = (await cookies()).get(TZ_COOKIE)?.value;
  if (tz && isValidTimeZone(tz)) return tz;
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
