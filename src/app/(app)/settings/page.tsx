import type { Metadata } from "next";
import { SettingsView } from "@/components/settings/settings-view";
import { getSettingsForUser, requireUser } from "@/lib/dal";
import { getCurrentUser } from "@/lib/user";

export const metadata: Metadata = { title: "Settings" };

/** Personal settings for the signed-in user. Everything is read through the DAL for the verified session user. */
export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const { section } = await searchParams;
  const user = await requireUser();
  const [view, google] = await Promise.all([getSettingsForUser(), getCurrentUser()]);
  return (
    <SettingsView
      initialSection={typeof section === "string" ? section : undefined}
      initial={view.snapshot}
      eveningPreviews={view.eveningPreviews}
      account={{
        // `requireUser` applies the Atlas-only name; the Google name is what blank falls back to.
        googleName: google?.displayName ?? user.displayName,
        email: user.email,
        initials: user.initials,
        avatarUrl: user.avatarUrl,
      }}
    />
  );
}
