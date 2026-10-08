import type { Metadata } from "next";
import { listNotificationsForUser } from "@/lib/dal";
import { InboxPage } from "@/components/notifications/inbox-page";

export const metadata: Metadata = { title: "Notifications" };

/** The personal inbox as a full page (mobile, narrow windows, and "Open the full inbox"). */
export default async function NotificationsPage() {
  // The first page is rendered on the server; if it can't be read the client fetches it and shows its own error state.
  const initial = await listNotificationsForUser({ filter: "all" }).catch(() => null);
  return <InboxPage initial={initial} serverNow={new Date().toISOString()} />;
}
