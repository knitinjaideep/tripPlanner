"use client";

import Link from "next/link";
import { saveNotificationSettings } from "@/app/actions/settings";
import { CheckRow, SaveBar, SectionCard, useSectionForm } from "@/components/settings/parts";
import { useDisplayPrefs } from "@/components/settings/settings-provider";
import { formatClockTime } from "@/lib/display-format";
import { zoneAbbreviation } from "@/lib/time-zones";
import {
  NOTIFICATION_GROUPS,
  NOTIFICATION_GROUP_INFO,
  type NotificationGroup,
  type EveningPreviewSchedule,
  type NotificationSettings,
  type SettingsSnapshot,
} from "@/lib/settings";

const pick = (s: SettingsSnapshot): NotificationSettings => s.notifications;

export function NotificationsSection({
  saved,
  remindersPausedElsewhere,
  eveningPreviews,
  onSaved,
}: {
  saved: NotificationSettings;
  remindersPausedElsewhere: boolean;
  eveningPreviews: EveningPreviewSchedule[];
  onSaved: (snapshot: SettingsSnapshot) => void;
}) {
  const form = useSectionForm<NotificationSettings>({ saved, save: saveNotificationSettings, pick, onSaved });
  const { clock } = useDisplayPrefs();
  const draft = form.draft;
  const remindersOn = draft.booking_reminders || draft.task_reminders;

  return (
    <SectionCard
      id="notifications"
      title="Notifications"
      intro="Notifications appear inside Atlas when you open the app. They do not alert you while the app is closed."
    >
      <div className="space-y-1" role="group" aria-label="Notification types">
        {NOTIFICATION_GROUPS.map((group: NotificationGroup) => (
          <CheckRow
            key={group}
            checked={draft[group]}
            onChange={(on) => form.update({ [group]: on })}
            label={NOTIFICATION_GROUP_INFO[group].label}
            description={NOTIFICATION_GROUP_INFO[group].description}
          />
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        Turning a type off stops new notifications of that kind. Everything already in your inbox stays there.
      </p>

      {draft.evening_preview ? (
        <div className="rounded-xl border border-border bg-secondary/60 p-3.5 text-sm text-ink">
          <p className="font-semibold">Evening preview times</p>
          <p className="mt-0.5 text-muted-foreground">Set separately for each trip, in that trip’s own time zone. Nothing here changes them.</p>
          {eveningPreviews.length > 0 ? (
            <ul className="mt-2 space-y-1.5">
              {eveningPreviews.map((p) => (
                <li key={p.tripId} className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <Link href={`/trips/${p.tripId}?evening=1`} className="focus-ring min-w-0 rounded font-semibold break-words text-moss-ink underline-offset-2 hover:underline">
                    {p.title}
                  </Link>
                  <span className="text-muted-foreground">
                    {formatClockTime(p.sendTime, clock)} {zoneAbbreviation(new Date().toISOString().slice(0, 10), p.sendTime, p.timeZone) ?? p.timeZone} trip time
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-muted-foreground">You haven’t turned previews on for any trip. Open a trip and choose “Evening preview” to set one up.</p>
          )}
        </div>
      ) : null}

      {remindersOn ? (
        <div className="rounded-xl border border-border bg-secondary/60 p-3.5 text-sm text-ink">
          <p className="font-semibold">Reminder schedules</p>
          <p className="mt-0.5 text-muted-foreground">
            Reminders are set up one booking or task at a time, from its own reminder button, and they follow that trip’s time zone. These switches only decide whether they reach you — Atlas never creates a reminder for you.
          </p>
          {remindersPausedElsewhere ? (
            <p className="mt-2 font-semibold">
              You’d turned reminders off in “Your reminder settings”. Saving with a reminder type switched on turns them back on (your quiet hours stay as they were).
            </p>
          ) : null}
        </div>
      ) : null}

      <SaveBar dirty={form.dirty} status={form.status} saveLabel="Save notifications" onSave={() => void form.submit()} onCancel={form.reset} />
    </SectionCard>
  );
}
