import { notFound } from "next/navigation";
import { EveningPreviewButton } from "@/components/trip/evening-preview-button";
import { ShareTripButton } from "@/components/trip/share-dialog";
import { RemindersProvider } from "@/components/reminders/reminders-provider";
import { TripAccessProvider } from "@/components/trip/trip-access";
import { TripActions } from "@/components/trip/trip-actions";
import { TripBottomNav } from "@/components/trip/trip-bottom-nav";
import { TripHeaderCompact } from "@/components/trip/trip-header";
import { TripHeaderSwitch } from "@/components/trip/trip-header-switch";
import { TripHero } from "@/components/trip/trip-hero";
import { TripLiveRefresh } from "@/components/trip/trip-live-refresh";
import { TripTabs } from "@/components/trip/trip-tabs";
import { TripWorkspace } from "@/components/trip/trip-workspace";
import { getReminderOverviewForUser, getShareViewForUser, getTripForUser, getTripVersionForUser, requireUser } from "@/lib/dal";
import { todayInTimeZone } from "@/lib/dates";
import { emailDeliveryConfigured, getAppOrigin } from "@/lib/email/invitation-email";
import { getViewerTimeZone } from "@/lib/timezone";

export default async function TripLayout({ children, params }: LayoutProps<"/trips/[tripId]">) {
  const { tripId } = await params;
  // The change fingerprint is read first, so an edit landing while the rest loads is picked up by the next poll.
  const version = await getTripVersionForUser(tripId).catch(() => null);
  const [user, trip, share, timeZone, overview] = await Promise.all([
    requireUser(),
    getTripForUser(tripId),
    getShareViewForUser(tripId),
    getViewerTimeZone(),
    getReminderOverviewForUser(tripId),
  ]);
  if (!trip || !share) notFound();
  // What each booking / task already has set up (for the small "Reminder on" cue). Reading this creates nothing.
  const summaries = Object.fromEntries((overview ?? []).filter((o) => o.active > 0).map((o) => [o.id, { active: o.active, summary: o.summary }]));
  const today = todayInTimeZone(timeZone);

  const actions = (
    <div className="flex items-center gap-2">
      <ShareTripButton
        tripId={trip.id}
        tripTitle={trip.title}
        view={share}
        emailConfigured={emailDeliveryConfigured()}
        appOrigin={getAppOrigin()}
        className="border border-border/60"
      />
      <EveningPreviewButton tripId={trip.id} className="border border-border/60" />
      {share.role === "owner" ? (
        <TripActions tripId={trip.id} title={trip.title} className="border border-border/60" />
      ) : null}
    </div>
  );

  return (
    <TripAccessProvider
      tripId={trip.id}
      role={share.role}
      userId={user.id}
      shared={share.members.length > 0}
      people={share.people}
    >
      <TripWorkspace tripId={trip.id} tripTimeZone={trip.time_zone} bookings={trip.reservations} documents={trip.documents}>
        <RemindersProvider tripId={trip.id} summaries={summaries}>
          {version ? <TripLiveRefresh tripId={trip.id} version={version} /> : null}
          <TripHeaderSwitch
            full={<TripHero trip={trip} today={today} actions={actions} />}
            compact={<TripHeaderCompact trip={trip} today={today} actions={actions} />}
          />
          <div className="mx-auto w-full max-w-[1280px] px-4 sm:px-6 lg:px-8">
            <TripTabs tripId={trip.id} />
            <div className="pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:pt-8 md:pb-16">{children}</div>
          </div>
          <TripBottomNav tripId={trip.id} />
        </RemindersProvider>
      </TripWorkspace>
    </TripAccessProvider>
  );
}
