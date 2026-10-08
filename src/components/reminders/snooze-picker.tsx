"use client";

import { useState } from "react";
import { AlarmClockOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { snoozeReminder } from "@/app/actions/reminders";
import { formatInstant, MIN_SNOOZE_MINUTES, zoneName } from "@/lib/reminders";
import { cn } from "@/lib/utils";

/**
 * Snooze one of the person's OWN reminders to a clearly shown new time. Quick
 * choices come from the server (already limited to before the booking starts /
 * the task is due); a custom "in N minutes/hours" is checked here for the
 * warning and again on the server, which is what actually decides.
 */
export function SnoozePicker({
  tripId,
  reminderId,
  options,
  limitAtMs,
  zone,
  subject,
  onSnoozed,
  className,
}: {
  tripId: string;
  reminderId: string;
  options: { id: string; label: string; atMs: number }[];
  limitAtMs: number | null;
  zone: string;
  subject: "booking" | "task";
  onSnoozed: (fireAt: string) => void;
  className?: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [custom, setCustom] = useState(false);
  const [amount, setAmount] = useState("30");
  const [unit, setUnit] = useState<"minutes" | "hours">("minutes");
  const [error, setError] = useState<string | null>(null);

  // "Now" is read when the person acts (an event), never during render.
  const [baseNow, setBaseNow] = useState(0);
  const n = Number(amount);
  const customMs = Number.isInteger(n) && n >= 1 ? n * (unit === "hours" ? 60 : 1) * 60_000 : null;
  const customAt = customMs === null ? null : baseNow + customMs;
  const customProblem =
    customAt === null
      ? `Enter a whole number (at least ${MIN_SNOOZE_MINUTES} minutes).`
      : customMs !== null && customMs < MIN_SNOOZE_MINUTES * 60_000
        ? `Choose at least ${MIN_SNOOZE_MINUTES} minutes from now.`
        : limitAtMs !== null && customAt >= limitAtMs
          ? subject === "booking"
            ? "That’s after this booking starts, so a reminder then would be too late."
            : "That’s after this task is due."
          : null;

  async function go(id: string, atMs: number) {
    setBusy(id);
    setError(null);
    const result = await snoozeReminder(tripId, reminderId, atMs);
    setBusy(null);
    if (!result.ok || !result.data) {
      setError(result.message ?? "Couldn’t snooze that.");
      return;
    }
    toast.success(`Snoozed until ${formatInstant(Date.parse(result.data.fireAt), zone)}, ${zoneName(zone)}.`);
    onSnoozed(result.data.fireAt);
  }

  return (
    <div className={cn("space-y-2", className)}>
      <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
        <AlarmClockOff className="size-4" aria-hidden="true" /> Snooze until
      </p>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            disabled={busy !== null}
            onClick={() => go(o.id, o.atMs)}
            className="focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-input bg-white px-3 text-sm font-semibold text-ink hover:bg-secondary disabled:opacity-60"
          >
            {busy === o.id ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
            {o.label}
            <span className="font-normal text-muted-foreground">· {formatInstant(o.atMs, zone).split(" at ")[1]}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setBaseNow(Date.now());
            setCustom((v) => !v);
          }}
          aria-expanded={custom}
          className="focus-ring inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-moss-ink hover:bg-moss-soft"
        >
          Other…
        </button>
      </div>
      {options.length === 0 && !custom ? (
        <p className="text-sm text-muted-foreground">There isn’t much time left to snooze — pick “Other” for a shorter one.</p>
      ) : null}
      {custom ? (
        <div className="rounded-xl bg-surface-warm p-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor={`sn-${reminderId}`}>
              Snooze for
            </label>
            <span className="text-sm text-ink">In</span>
            <input
              id={`sn-${reminderId}`}
              inputMode="numeric"
              value={amount}
              onChange={(e) => {
                setBaseNow(Date.now());
                setAmount(e.target.value.replace(/\D/g, "").slice(0, 4));
              }}
              className="h-11 w-20 rounded-[10px] border border-input bg-white px-3 text-[0.9375rem] text-ink"
            />
            <select
              aria-label="Unit"
              value={unit}
              onChange={(e) => {
                setBaseNow(Date.now());
                setUnit(e.target.value as "minutes" | "hours");
              }}
              className="h-11 rounded-[10px] border border-input bg-white px-2 text-[0.9375rem] text-ink"
            >
              <option value="minutes">minutes</option>
              <option value="hours">hours</option>
            </select>
            <button
              type="button"
              disabled={customProblem !== null || busy !== null}
              onClick={() => customMs !== null && go("custom", Date.now() + customMs)}
              className="focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-moss-ink px-4 text-sm font-semibold text-white hover:bg-moss-hover disabled:opacity-50"
            >
              {busy === "custom" ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
              Snooze
            </button>
          </div>
          <p className={cn("mt-2 text-sm", customProblem ? "text-[#8c2b1f]" : "text-muted-foreground")} role={customProblem ? "alert" : undefined}>
            {customProblem ?? (customAt ? `New reminder time: ${formatInstant(customAt, zone)}, ${zoneName(zone)}.` : "")}
          </p>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-[#8c2b1f]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
