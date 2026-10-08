"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlarmClock } from "lucide-react";
import { useTripAccess } from "@/components/trip/trip-access";
import { cn } from "@/lib/utils";
import { ReminderDialog, type ReminderTarget } from "./reminder-dialog";
import { ReminderPrefsDialog } from "./reminder-prefs-dialog";
import { ReminderReviewDialog } from "./reminder-review-dialog";

type Summary = { active: number; summary: string | null };

type Value = {
  /** Open the reminder control for one booking or task. */
  open: (target: ReminderTarget) => void;
  openReview: () => void;
  summaryFor: (id: string) => Summary | null;
  /** A task a link pointed at (?task=…): the packing list scrolls to and highlights it. */
  focusTaskId: string | null;
};

const Ctx = createContext<Value | null>(null);

export function useReminders() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useReminders must be used inside <RemindersProvider>");
  return ctx;
}

/**
 * Mounts the one reminder control, the review list and the settings dialog for
 * the trip, and lets any booking or task row open them. Also understands the
 * links reminders carry (`&reminders=1`), which only ever OPEN things: nothing changes without an explicit, authenticated action.
 */
export function RemindersProvider({ tripId, summaries, children }: { tripId: string; summaries: Record<string, Summary>; children: ReactNode }) {
  const router = useRouter();
  const params = useSearchParams();
  const [target, setTarget] = useState<ReminderTarget | null>(null);
  const [review, setReview] = useState(false);
  const [settings, setSettings] = useState(false);
  const [version, setVersion] = useState(0);

  const bookingParam = params.get("booking");
  const taskParam = params.get("task");
  const wantsPanel = params.get("reminders") === "1";
  const handled = useRef<string | null>(null);
  useEffect(() => {
    const key = `${bookingParam}|${taskParam}|${wantsPanel}`;
    if (handled.current === key) return;
    handled.current = key;
    // "Manage reminders" links carry reminders=1; a plain ?booking= link is opened by the booking sheet itself.
    if (!wantsPanel) return;
    /* eslint-disable react-hooks/set-state-in-effect -- open once for the link the person followed */
    if (bookingParam && /^[0-9a-f-]{36}$/i.test(bookingParam)) setTarget({ type: "booking", id: bookingParam });
    else if (taskParam && /^[0-9a-f-]{36}$/i.test(taskParam)) setTarget({ type: "task", id: taskParam });
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [bookingParam, taskParam, wantsPanel]);

  const value = useMemo<Value>(
    () => ({
      open: setTarget,
      openReview: () => setReview(true),
      summaryFor: (id) => summaries[id] ?? null,
      focusTaskId: taskParam && /^[0-9a-f-]{36}$/i.test(taskParam) ? taskParam : null,
    }),
    [summaries, taskParam],
  );
  const changed = useCallback(() => {
    setVersion((v) => v + 1);
    router.refresh();
  }, [router]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <ReminderDialog tripId={tripId} target={target} onOpenChange={(o) => !o && setTarget(null)} onChanged={changed} onOpenSettings={() => setSettings(true)} />
      <ReminderReviewDialog
        tripId={tripId}
        open={review}
        onOpenChange={setReview}
        version={version}
        onPick={(t) => {
          setReview(false);
          setTarget(t);
        }}
      />
      <ReminderPrefsDialog open={settings} onOpenChange={setSettings} />
    </Ctx.Provider>
  );
}

/** A compact control for a booking's or task's details: shows whether a reminder is set and opens the control. */
export function ReminderButton({ type, id, className }: { type: "booking" | "task"; id: string; className?: string }) {
  const { open, summaryFor } = useReminders();
  const s = summaryFor(id);
  return (
    <button
      type="button"
      onClick={() => open({ type, id })}
      className={cn("focus-ring inline-flex min-h-11 items-center gap-2 rounded-xl border border-input bg-white px-3.5 text-sm font-semibold text-ink hover:bg-secondary", className)}
    >
      <AlarmClock className="size-4" aria-hidden="true" />
      {s && s.active > 0 ? <span>Reminder on{s.summary ? <span className="font-normal text-muted-foreground"> · {s.summary}</span> : null}</span> : <span>Reminders</span>}
    </button>
  );
}

/** "Set up reminders" for the trip's header areas. */
export function ReminderReviewButton({ className, children }: { className?: string; children?: ReactNode }) {
  const { openReview } = useReminders();
  const { canEdit } = useTripAccess();
  // Setting reminders up is an edit: owners and editors only (recipients manage their own from the inbox / the control).
  if (!canEdit) return null;
  return (
    <button type="button" onClick={openReview} className={className}>
      {children ?? (
        <>
          <AlarmClock className="size-4" aria-hidden="true" /> Set up reminders
        </>
      )}
    </button>
  );
}
