"use client";

import { useCallback, useState } from "react";
import { Bell, Compass, Palette, SlidersHorizontal, UserRound, type LucideIcon } from "lucide-react";
import { AccountSection } from "@/components/settings/account-section";
import { AppearanceSection } from "@/components/settings/appearance-section";
import { DisplaySection } from "@/components/settings/display-section";
import { NotificationsSection } from "@/components/settings/notifications-section";
import { TravelSection } from "@/components/settings/travel-section";
import type { EveningPreviewSchedule, SettingsSnapshot } from "@/lib/settings";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "travel", label: "Travel preferences", icon: Compass },
  { id: "display", label: "Display preferences", icon: SlidersHorizontal },
  { id: "account", label: "Account", icon: UserRound },
] as const satisfies readonly { id: string; label: string; icon: LucideIcon }[];
type SectionId = (typeof SECTIONS)[number]["id"];

export const isSettingsSection = (value: string | undefined): value is SectionId => SECTIONS.some((s) => s.id === value);

export type SettingsAccount = {
  googleName: string;
  email: string | null;
  initials: string;
  avatarUrl: string | null;
};

/**
 * The Settings screen. Every section stays mounted (only the active one is
 * visible), so an unsaved draft in one section survives looking at another.
 * Each section saves on its own; none of them writes anything else.
 */
export function SettingsView({
  initial,
  eveningPreviews,
  account,
  initialSection,
}: {
  initialSection: string | undefined;
  initial: SettingsSnapshot;
  eveningPreviews: EveningPreviewSchedule[];
  account: SettingsAccount;
}) {
  const [settings, setSettings] = useState(initial);
  const [active, setActive] = useState<SectionId>(isSettingsSection(initialSection) ? initialSection : "appearance");

  const choose = (id: SectionId) => {
    setActive(id);
    window.history.replaceState(null, "", `?section=${id}`);
  };

  // The server's confirmed values are the new "saved" state for every section.
  const onSaved = useCallback((snapshot: SettingsSnapshot) => setSettings(snapshot), []);

  return (
    <div data-settings="" className="mx-auto w-full max-w-[1100px] px-4 pt-6 pb-[max(2.5rem,calc(env(safe-area-inset-bottom)+1.5rem))] sm:px-6 sm:pt-8 lg:px-8">
      <header className="mb-5">
        <h1 className="font-display text-3xl font-semibold text-ink sm:text-4xl">Settings</h1>
        <p className="mt-1 text-[0.9375rem] text-muted-foreground">
          Personal to you — they apply when you view any trip, including ones shared with you. Trip details, members and invitations are in each trip’s own settings.
        </p>
      </header>

      <div className="md:grid md:grid-cols-[13.5rem_minmax(0,1fr)] md:items-start md:gap-8">
        <nav aria-label="Settings sections" className="mb-5 md:sticky md:top-[calc(6rem+var(--atlas-bar-h,0px))] md:mb-0">
          <ul className="flex flex-wrap gap-2 md:flex-col md:gap-1 md:rounded-2xl md:border md:border-border md:bg-surface/95 md:p-2">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <li key={id} className="min-w-0 md:w-full">
                <button
                  type="button"
                  onClick={() => choose(id)}
                  aria-current={active === id ? "page" : undefined}
                  className={cn(
                    "focus-ring flex min-h-11 w-full items-center gap-2 rounded-xl border px-3.5 text-left text-[0.9375rem] font-semibold md:border-transparent",
                    active === id ? "border-moss-ink bg-moss-soft text-moss-ink" : "border-input bg-surface/95 text-ink hover:bg-secondary md:bg-transparent",
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0">{label}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 max-w-2xl">
          <Panel id="appearance" active={active}>
            <AppearanceSection />
          </Panel>
          <Panel id="notifications" active={active}>
            <NotificationsSection
              saved={settings.notifications}
              remindersPausedElsewhere={settings.remindersPausedElsewhere}
              eveningPreviews={eveningPreviews}
              onSaved={onSaved}
            />
          </Panel>
          <Panel id="travel" active={active}>
            <TravelSection saved={settings.travel} onSaved={onSaved} />
          </Panel>
          <Panel id="display" active={active}>
            <DisplaySection saved={settings.display} onSaved={onSaved} />
          </Panel>
          <Panel id="account" active={active}>
            <AccountSection {...account} displayNameOverride={settings.displayNameOverride} />
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Panel({ id, active, children }: { id: SectionId; active: SectionId; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} hidden={active !== id}>
      {children}
    </section>
  );
}
