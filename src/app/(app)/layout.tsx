import { connection } from "next/server";
import { preload } from "react-dom";
import { AppearanceBar } from "@/components/appearance/appearance-bar";
import { SiteHeader } from "@/components/site-header";
import { SetupNotice } from "@/components/setup-notice";
import { missingConfig } from "@/lib/env";
import { NotificationsProvider } from "@/components/notifications/notifications-provider";
import { SettingsProvider } from "@/components/settings/settings-provider";
import { getNotificationSummaryForUser, getSettingsForUser, requireUser } from "@/lib/dal";
import { availableBackgrounds } from "@/lib/background-assets";
import { backgroundUrl, defaultAppearance, defaultDisplayPreferences, effectiveAppearance } from "@/lib/settings";
import { getConfiguredTimeZone } from "@/lib/timezone";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  // Always per-request: auth and env are runtime concerns, never prerendered.
  await connection();
  const missing = missingConfig();
  if (missing.length > 0) return <SetupNotice missing={missing} />;
  // For the header only. Every page and action re-verifies through the DAL.
  const user = await requireUser();
  // The bell must never take the app down: if the inbox can't be read, show no count and let the poll retry.
  const [summary, timeZone, settings] = await Promise.all([
    getNotificationSummaryForUser().catch(() => ({ unread: 0, latest: null })),
    getConfiguredTimeZone(),
    // Same for appearance: if Settings can't be read, the app still renders with the defaults.
    getSettingsForUser().catch(async () => {
      const available = await availableBackgrounds();
      return { snapshot: null, available, eveningPreviews: [] };
    }),
  ]);
  const snapshot = settings.snapshot;
  const appearance = snapshot?.appearance ?? defaultAppearance(settings.available);
  // Fetch the active picture with the page itself (only that one) so the first paint already has it.
  const activePicture = backgroundUrl(effectiveAppearance(appearance, settings.available).background);
  if (activePicture) preload(activePicture, { as: "image" });

  return (
    // Keyed by account: a different person never inherits the previous person's draft or cached appearance.
    <SettingsProvider
      key={user.id}
      initialAppearance={appearance}
      initialAppearanceVersion={snapshot?.appearanceVersion ?? 0}
      initialAppearanceSaved={snapshot?.appearanceSaved ?? false}
      initialDisplay={snapshot?.display ?? defaultDisplayPreferences()}
      available={settings.available}
    >
      <NotificationsProvider initial={summary} timeZone={timeZone}>
        <SiteHeader user={user} />
        <AppearanceBar />
        <div className="min-w-0 flex-1">{children}</div>
      </NotificationsProvider>
    </SettingsProvider>
  );
}
