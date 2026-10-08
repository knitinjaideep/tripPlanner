"use client";

import { useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, Navigation, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { setPackingItemPacked } from "@/app/actions/packing";
import { SnoozePicker } from "@/components/reminders/snooze-picker";
import type { NotificationItem } from "@/lib/notifications";
import { cn } from "@/lib/utils";

const STATE_TEXT = {
  updated: "Updated — open for the current time",
  canceled: "Canceled",
  completed: "Completed",
  snoozed: "Snoozed",
} as const;

const button =
  "focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-input bg-white px-3 text-sm font-semibold text-ink hover:bg-secondary disabled:opacity-60";

/**
 * What a reminder in the inbox offers. Every button either OPENS something
 * (plain links to signed-in pages) or calls an authenticated action; the
 * "live" facts come from the server at read time, so an old reminder never
 * offers something the person can no longer do. Completing and snoozing change
 * data only through those actions — never through a link.
 */
export function ReminderActions({ item, onActed }: { item: NotificationItem; onActed: () => void }) {
  const info = item.reminder;
  const [busy, setBusy] = useState(false);
  const [snoozing, setSnoozing] = useState(false);
  if (!info || !item.available || !item.href || !item.trip) return null;
  const { live } = info;
  const tripId = item.trip.id;
  const isTask = info.subject === "task";
  const current = !info.state && !(live?.superseded ?? false);

  async function complete() {
    setBusy(true);
    const result = await setPackingItemPacked(tripId, info!.subjectId, true);
    setBusy(false);
    if (result.ok) toast.success("Marked complete.");
    else toast.error(result.message ?? "Couldn’t do that.");
    onActed();
  }

  return (
    <div className="space-y-2 px-3 pb-3 pl-[3.75rem]">
      {info.state || live?.superseded ? (
        <p className="inline-block rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-muted-foreground">
          {info.state ? STATE_TEXT[info.state] : "Replaced by a newer reminder"}
        </p>
      ) : null}
      {live?.taskDone && current ? <p className="text-sm text-muted-foreground">This task is complete.</p> : null}
      <div className="flex flex-wrap gap-2">
        <a href={item.href} className={button}>
          {isTask ? "View task" : "View booking"}
        </a>
        {live?.directionsUrl ? (
          <a href={live.directionsUrl} target="_blank" rel="noopener noreferrer" className={button}>
            <Navigation className="size-4" aria-hidden="true" /> Directions <ExternalLink className="size-3.5" aria-hidden="true" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : null}
        <a href={`${item.href}&reminders=1`} className={button}>
          <Settings2 className="size-4" aria-hidden="true" /> Manage reminders
        </a>
        {isTask && live?.canComplete ? (
          <button type="button" onClick={complete} disabled={busy} className={cn(button, "border-moss-ink text-moss-ink")}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="size-4" aria-hidden="true" />} Mark complete
          </button>
        ) : null}
        {live?.canSnooze ? (
          <button type="button" onClick={() => setSnoozing((v) => !v)} aria-expanded={snoozing} className={button}>
            Snooze…
          </button>
        ) : null}
      </div>
      {snoozing && live?.canSnooze ? (
        <SnoozePicker
          tripId={tripId}
          reminderId={info.reminderId}
          options={live.snoozeOptions}
          limitAtMs={live.limitAtMs}
          zone={live.zone}
          subject={info.subject}
          onSnoozed={() => {
            setSnoozing(false);
            onActed();
          }}
        />
      ) : null}
    </div>
  );
}
