"use client";

import { useCallback, useEffect, useState } from "react";
import { AlarmClock, CheckCircle2, Loader2 } from "lucide-react";
import { loadReminderOverview } from "@/app/actions/reminders";
import { FormMessage } from "@/components/forms/fields";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { OverviewRow } from "@/lib/reminders";
import { cn } from "@/lib/utils";
import type { ReminderTarget } from "./reminder-dialog";

/**
 * "Set up reminders": a review list of what COULD have a reminder — confirmed,
 * scheduled bookings and unfinished tasks that are assigned and have a due date
 * still ahead — and whether anything is set up. Reading it creates nothing;
 * each row opens the reminder control for that one record.
 */
export function ReminderReviewDialog({ tripId, open, onOpenChange, onPick, version }: { tripId: string; open: boolean; onOpenChange: (open: boolean) => void; onPick: (target: ReminderTarget) => void; version: number }) {
  const [rows, setRows] = useState<OverviewRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const result = await loadReminderOverview(tripId);
    if (!result.ok || !result.data) {
      setError(result.message ?? "Couldn’t load that.");
      return;
    }
    setError(null);
    setRows(result.data);
  }, [tripId]);
  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load, version]);

  const bookings = rows?.filter((r) => r.type === "booking") ?? [];
  const tasks = rows?.filter((r) => r.type === "task") ?? [];
  const section = (title: string, list: OverviewRow[]) =>
    list.length === 0 ? null : (
      <section aria-label={title}>
        <h3 className="eyebrow mb-2 text-muted-foreground">{title}</h3>
        <ul className="space-y-2">
          {list.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onPick({ type: r.type, id: r.id })}
                className="focus-ring flex min-h-14 w-full items-center gap-3 rounded-2xl border border-border bg-surface p-3 text-left hover:bg-secondary/50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold break-words text-ink">{r.title}</span>
                  <span className="block text-sm text-muted-foreground">{r.whenText}</span>
                </span>
                <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", r.active ? "bg-moss-soft text-moss-ink" : "bg-secondary text-muted-foreground")}>
                  {r.active ? <CheckCircle2 className="size-3.5" aria-hidden="true" /> : <AlarmClock className="size-3.5" aria-hidden="true" />}
                  {r.active ? (r.summary ?? "On") : "Set up"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-1.5rem)] gap-0 overflow-y-auto rounded-2xl p-0 sm:max-w-lg">
        <DialogHeader className="gap-1 px-5 pt-5 pr-14 pb-3 sm:px-6">
          <DialogTitle className="font-display text-2xl font-semibold text-ink">Set up reminders</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Nothing is set up for you automatically. Pick a confirmed booking or an assigned task to choose who’s reminded, and when.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5 px-5 pb-5 sm:px-6">
          {error ? <FormMessage message={error} /> : null}
          {!rows && !error ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading…
            </p>
          ) : null}
          {rows && rows.length === 0 ? (
            <p className="rounded-xl bg-surface p-4 text-sm text-ink">
              Nothing here can have a reminder yet. Bookings need to be confirmed with a start date and time; tasks need someone assigned and a due date.
            </p>
          ) : null}
          {section("Bookings", bookings)}
          {section("Tasks", tasks)}
        </div>
      </DialogContent>
    </Dialog>
  );
}
