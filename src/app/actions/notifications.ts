"use server";

import {
  markAllNotificationsReadForUser,
  markNotificationReadForUser,
  openNotificationForUser,
} from "@/lib/dal";
import { isTimestamp } from "@/lib/notifications";
import { idSchema } from "@/lib/validation";
import type { ActionState } from "@/lib/types";
import { guarded } from "./shared";

/**
 * Inbox mutations. They take only a notification id (or the "up to" marker of
 * what the person was looking at): who it belongs to comes from the verified
 * session, and where it leads is worked out on the server — a destination is
 * never accepted from the browser. Notifications are created by the app's
 * own events, never through an action.
 */

export type OpenNotificationState = ActionState & { href?: string | null; available?: boolean };

/** Opening one item marks just that item read and returns where it leads (re-checked now). */
export async function openNotification(notificationId: string): Promise<OpenNotificationState> {
  if (!idSchema.safeParse(notificationId).success) return { ok: false, message: "That notification isn’t available." };
  return guarded("openNotification", async () => {
    const item = await openNotificationForUser(notificationId);
    if (!item) return { ok: false, message: "That notification isn’t available." };
    return { ok: true, href: item.href, available: item.available } satisfies OpenNotificationState;
  });
}

export async function markNotificationRead(notificationId: string): Promise<ActionState> {
  if (!idSchema.safeParse(notificationId).success) return { ok: false, message: "That notification isn’t available." };
  return guarded("markNotificationRead", async () =>
    (await markNotificationReadForUser(notificationId))
      ? { ok: true }
      : { ok: false, message: "That notification isn’t available." },
  );
}

/** `upTo` = the newest `created_at` the person has seen; anything newer stays unread. */
export async function markAllNotificationsRead(upTo: string | null): Promise<ActionState & { marked?: number }> {
  if (upTo !== null && !isTimestamp(upTo)) return { ok: false, message: "Something went wrong. Please try again." };
  return guarded("markAllNotificationsRead", async () => {
    const marked = await markAllNotificationsReadForUser(upTo);
    return { ok: true, marked } as ActionState & { marked: number };
  }) as Promise<ActionState & { marked?: number }>;
}
