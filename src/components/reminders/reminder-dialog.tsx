"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlarmClock, AlertTriangle, BellOff, Loader2, Settings2 } from "lucide-react";
import { toast } from "sonner";
import {
  allowQuietReminder,
  loadReminderPanel,
  muteReminder,
  previewReminder,
  saveReminder,
  type PreviewData,
} from "@/app/actions/reminders";
import { FormMessage, secondaryButtonClass } from "@/components/forms/fields";
import { useTripAccess } from "@/components/trip/trip-access";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BOOKING_PRESETS, PRESET_LABEL, TASK_PRESETS, clock12, statusText, type PresetChoice, type ReminderPanel, type ReminderView } from "@/lib/reminders";
import { cn } from "@/lib/utils";
import { SnoozePicker } from "./snooze-picker";

export type ReminderTarget = { type: "booking" | "task"; id: string };

const primaryButton =
  "focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-moss-ink px-5 text-[0.9375rem] font-semibold text-white hover:bg-moss-hover disabled:opacity-60";

/**
 * The small reminder control for ONE booking or task: who will be reminded,
 * when (always with the zone), by which channel, and where each reminder
 * stands. Owners and editors set it up; every recipient controls their own
 * (snooze, turn off) and their own delivery settings. Nothing is created until
 * "Save reminder" is pressed.
 */
export function ReminderDialog({
  tripId,
  target,
  onOpenChange,
  onChanged,
  onOpenSettings,
}: {
  tripId: string;
  target: ReminderTarget | null;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-1.5rem)] gap-0 overflow-y-auto rounded-2xl p-0 sm:max-w-lg">
        {target ? <Body key={`${target.type}-${target.id}`} tripId={tripId} target={target} onChanged={onChanged} onOpenSettings={onOpenSettings} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Body({ tripId, target, onChanged, onOpenSettings }: { tripId: string; target: ReminderTarget; onChanged: () => void; onOpenSettings: () => void }) {
  const { canEdit } = useTripAccess();
  const [panel, setPanel] = useState<ReminderPanel | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await loadReminderPanel(tripId, target.type, target.id);
    if (!result.ok || !result.data) {
      setError(result.message ?? "Couldn’t load reminders.");
      return;
    }
    setError(null);
    setPanel(result.data);
  }, [tripId, target.type, target.id]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load when the dialog opens
    void load();
  }, [load]);

  const refresh = async () => {
    await load();
    onChanged();
  };

  const isTask = target.type === "task";
  const mine = panel?.reminders.filter((r) => r.recipient.isYou && r.status !== "canceled") ?? [];
  const others = panel?.reminders ?? [];

  return (
    <>
      <DialogHeader className="gap-1 px-5 pt-5 pr-14 pb-3 sm:px-6">
        <DialogTitle className="font-display text-2xl font-semibold text-ink">{isTask ? "Task reminder" : "Booking reminder"}</DialogTitle>
        <DialogDescription className="text-sm break-words text-muted-foreground">
          {panel ? (
            <>
              <span className="font-semibold text-ink">{panel.subject.title}</span>
              {panel.subject.whenText ? <> · {isTask ? "due " : ""}{panel.subject.whenText}</> : null}
            </>
          ) : (
            "Who gets reminded, and when."
          )}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-5 px-5 pb-5 sm:px-6">
        {error ? <FormMessage message={error} /> : null}
        {!panel && !error ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading…
          </p>
        ) : null}
        {panel ? (
          <>
            {panel.subject.zoneName ? (
              <p className="text-sm text-muted-foreground">
                Times are in <span className="font-semibold text-ink">{panel.subject.zoneName}</span>
                {panel.subject.zoneNote ? ` — ${panel.subject.zoneNote}` : "."}
              </p>
            ) : null}
            {!panel.scheduler.active ? (
              <p className="flex items-start gap-2.5 rounded-xl border border-gold/60 bg-gold-soft/60 p-3 text-sm text-ink">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>Scheduled delivery isn’t running for this app yet, so reminders won’t arrive until the app’s owner switches it on. You can still set them up now.</span>
              </p>
            ) : null}
            {panel.subject.problem ? (
              <p className="rounded-xl border border-border bg-surface p-3 text-sm text-ink" role="status">
                {panel.subject.problem}
              </p>
            ) : null}

            {canEdit && panel.subject.eligible ? <SetupForm tripId={tripId} target={target} panel={panel} onSaved={refresh} /> : null}

            <section aria-labelledby="rm-current" className="space-y-3">
              <h3 id="rm-current" className="eyebrow text-muted-foreground">
                Set up now
              </h3>
              {others.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {isTask ? "No reminder is set for this task." : "No reminder is set for this booking."} Nothing is sent unless one is set up here.
                </p>
              ) : (
                <ul className="space-y-3">
                  {others.map((r) => (
                    <ReminderRowView key={r.id} tripId={tripId} panel={panel} r={r} onChanged={refresh} />
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
          <button type="button" onClick={onOpenSettings} className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-moss-ink hover:bg-moss-soft">
            <Settings2 className="size-4" aria-hidden="true" /> Your reminder settings
          </button>
          {mine.length > 0 ? <span className="text-xs text-muted-foreground">You control your own reminders.</span> : null}
        </div>
      </div>
    </>
  );
}

const CHANNEL_TEXT = (r: ReminderView) => (r.channels.email ? "Inbox + email" : "Inbox");

function ReminderRowView({ tripId, panel, r, onChanged }: { tripId: string; panel: ReminderPanel; r: ReminderView; onChanged: () => void }) {
  const [snoozing, setSnoozing] = useState(false);
  const [busy, setBusy] = useState(false);
  const live = r.status === "pending" || r.status === "sending" || r.status === "sent";
  const tone =
    r.status === "sent" ? "bg-moss-soft text-moss-ink"
    : r.status === "failed" ? "bg-[#fff1ee] text-[#8c2b1f]"
    : r.status === "canceled" || r.status === "skipped" ? "bg-secondary text-muted-foreground"
    : "bg-gold-soft text-gold-ink";
  return (
    <li className="rounded-2xl border border-border bg-surface p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold break-words text-ink">{r.recipient.isYou ? "You" : r.recipient.name}</p>
          <p className="text-sm text-muted-foreground">{r.ruleText} · {CHANNEL_TEXT(r)}</p>
        </div>
        <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold", tone)}>{statusText(r)}</span>
      </div>
      {live && r.fireText && r.status !== "sent" ? <p className="mt-1.5 text-sm text-ink">{r.fireText}</p> : null}
      {r.status === "sent" ? <p className="mt-1.5 text-sm text-muted-foreground">Delivered. Opening it from the inbox always shows the current details.</p> : null}
      {r.adjustmentNote ? <p className="mt-1.5 text-sm text-ink">{r.adjustmentNote}</p> : r.adjusted && !r.recipient.isYou ? <p className="mt-1.5 text-sm text-muted-foreground">Adjusted for quiet hours.</p> : null}
      {r.emailStatus === "failed" && r.status === "sent" ? <p className="mt-1.5 text-sm text-muted-foreground">The email couldn’t be delivered; the inbox item was.</p> : null}
      {r.recipient.isYou ? (
        <div className="mt-3 space-y-3">
          {r.canAllowQuiet ? (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const result = await allowQuietReminder(tripId, r.id);
                setBusy(false);
                if (result.ok) toast.success(result.message);
                else toast.error(result.message ?? "Couldn’t do that.");
                onChanged();
              }}
              className={secondaryButtonClass}
            >
              Send it anyway
            </button>
          ) : null}
          {r.canSnooze ? (
            snoozing ? (
              <SnoozePicker
                tripId={tripId}
                reminderId={r.id}
                options={panel.snoozeOptions}
                limitAtMs={panel.subject.limitAtMs}
                zone={r.zone}
                subject={panel.subject.type}
                onSnoozed={() => {
                  setSnoozing(false);
                  onChanged();
                }}
              />
            ) : (
              <button type="button" onClick={() => setSnoozing(true)} className="focus-ring inline-flex min-h-11 items-center rounded-xl border border-input bg-white px-3.5 text-sm font-semibold text-ink hover:bg-secondary">
                Snooze…
              </button>
            )
          ) : null}
          {r.status !== "canceled" ? (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const result = await muteReminder(tripId, r.id);
                setBusy(false);
                if (result.ok) toast.success(result.message);
                else toast.error(result.message ?? "Couldn’t do that.");
                onChanged();
              }}
              className="focus-ring ml-1 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-muted-foreground hover:bg-secondary hover:text-ink"
            >
              <BellOff className="size-4" aria-hidden="true" /> Turn off my reminder
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/* --------------------------------- setup --------------------------------- */

function SetupForm({ tripId, target, panel, onSaved }: { tripId: string; target: ReminderTarget; panel: ReminderPanel; onSaved: () => void }) {
  const isTask = target.type === "task";
  const presets = (isTask ? TASK_PRESETS : BOOKING_PRESETS) as readonly PresetChoice[];
  const existing = panel.reminders.find((r) => r.status !== "canceled");
  const [preset, setPreset] = useState<PresetChoice | null>(existing ? existing.preset : null);
  const [amount, setAmount] = useState(existing && existing.preset === "custom" && existing.rule.kind === "lead" ? String(existing.rule.leadMinutes >= 1440 && existing.rule.leadMinutes % 1440 === 0 ? existing.rule.leadMinutes / 1440 : existing.rule.leadMinutes % 60 === 0 ? existing.rule.leadMinutes / 60 : existing.rule.leadMinutes) : "3");
  const [unit, setUnit] = useState<"minutes" | "hours" | "days">(existing && existing.preset === "custom" && existing.rule.kind === "lead" ? (existing.rule.leadMinutes >= 1440 && existing.rule.leadMinutes % 1440 === 0 ? "days" : existing.rule.leadMinutes % 60 === 0 ? "hours" : "minutes") : "hours");
  const [days, setDays] = useState(existing && existing.rule.kind === "day" ? String(existing.rule.daysBefore) : "2");
  const [time, setTime] = useState(existing && existing.rule.kind === "day" ? existing.rule.localTime : "");
  const [recipients, setRecipients] = useState<string[]>(
    isTask ? [] : panel.reminders.filter((r) => r.status !== "canceled" && r.reason !== "unselected").map((r) => r.recipient.id),
  );
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dateOnly = panel.subject.dateOnly;

  const customReady = preset !== "custom" || (dateOnly ? /^\d+$/.test(days) : /^\d+$/.test(amount));
  const timeReady = !dateOnly || preset === "off" || /^\d\d:\d\d$/.test(time);
  const ready = preset !== null && customReady && timeReady && (isTask || preset === "off" || recipients.length > 0);

  const input = useCallback(
    () => ({
      preset: preset ?? "off",
      recipient_ids: isTask ? [] : recipients,
      ...(preset === "custom" ? (dateOnly ? { custom_days: Number(days) } : { custom_amount: Number(amount), custom_unit: unit }) : {}),
      ...(dateOnly ? { local_time: time || null } : {}),
    }),
    [preset, recipients, isTask, dateOnly, days, amount, unit, time],
  );

  // A live preview from the server (it knows each person's quiet hours and the record's zone). Debounced; writes nothing.
  const seq = useRef(0);
  useEffect(() => {
    if (!ready || preset === "off") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing a stale preview
      setPreview(null);
      return;
    }
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      const result = await previewReminder(tripId, target.type, target.id, input());
      if (mine === seq.current) setPreview(result.ok && result.data ? result.data : null);
    }, 250);
    return () => clearTimeout(t);
  }, [ready, preset, tripId, target.type, target.id, input]);

  async function save() {
    setSaving(true);
    setError(null);
    const result = await saveReminder(tripId, target.type, target.id, input());
    setSaving(false);
    if (!result.ok) {
      setError(result.message ?? "Couldn’t save that.");
      return;
    }
    toast.success(preset === "off" ? "Reminder turned off." : "Reminder saved.");
    onSaved();
  }

  const person = (id: string) => panel.people.find((p) => p.id === id);
  const assignee = panel.subject.assigneeId ? person(panel.subject.assigneeId) : null;

  return (
    <section aria-labelledby="rm-setup" className="space-y-4 rounded-2xl border border-border bg-white p-4">
      <h3 id="rm-setup" className="font-display text-lg font-semibold text-ink">
        {existing ? "Change the reminder" : "Set up a reminder"}
      </h3>
      <fieldset>
        <legend className="mb-1.5 text-sm font-semibold text-ink">When</legend>
        <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
          {presets.map((p) => (
            <label
              key={p}
              className={cn(
                "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl border px-3 text-[0.9375rem]",
                preset === p ? "border-moss-ink bg-moss-soft font-semibold text-moss-ink" : "border-input bg-white text-ink hover:bg-secondary",
              )}
            >
              <input type="radio" name="rm-preset" checked={preset === p} onChange={() => setPreset(p)} className="size-4 accent-[#3E7A3A]" />
              {PRESET_LABEL[p]}
            </label>
          ))}
        </div>
      </fieldset>
      {preset === "custom" ? (
        dateOnly ? (
          <div className="flex flex-wrap items-center gap-2">
            <input aria-label="Days before the due date" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, "").slice(0, 2))} className="h-11 w-20 rounded-[10px] border border-input bg-white px-3 text-[0.9375rem] text-ink" />
            <span className="text-sm text-ink">days before the due date</span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <input aria-label="Amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, "").slice(0, 5))} className="h-11 w-24 rounded-[10px] border border-input bg-white px-3 text-[0.9375rem] text-ink" />
            <select aria-label="Unit" value={unit} onChange={(e) => setUnit(e.target.value as typeof unit)} className="h-11 rounded-[10px] border border-input bg-white px-2 text-[0.9375rem] text-ink">
              <option value="minutes">minutes</option>
              <option value="hours">hours</option>
              <option value="days">days</option>
            </select>
            <span className="text-sm text-ink">before {isTask ? "it’s due" : "it starts"}</span>
          </div>
        )
      ) : null}
      {dateOnly && preset && preset !== "off" ? (
        <div>
          <label htmlFor="rm-time" className="mb-1 block text-sm font-semibold text-ink">
            Time of day to remind
          </label>
          <input id="rm-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-11 rounded-[10px] border border-input bg-white px-3 text-[0.9375rem] text-ink" />
          <p className="mt-1 text-xs text-muted-foreground">
            This task has a date but no time, so a time of day is needed.{" "}
            {panel.defaultTaskTime ? (
              <button type="button" onClick={() => setTime(panel.defaultTaskTime)} className="focus-ring rounded font-semibold text-moss-ink underline underline-offset-2">
                Use my default, {clock12(panel.defaultTaskTime)}
              </button>
            ) : null}
          </p>
        </div>
      ) : null}

      {isTask ? (
        <p className="text-sm text-ink">
          Goes only to the person it’s assigned to: <span className="font-semibold">{assignee ? (assignee.isYou ? "you" : assignee.name) : "nobody yet"}</span>.
        </p>
      ) : (
        <fieldset>
          <legend className="mb-1.5 text-sm font-semibold text-ink">Who should be reminded?</legend>
          <p className="mb-2 text-xs text-muted-foreground">Choose people on this trip. Nobody is reminded unless you pick them.</p>
          <ul className="space-y-1">
            {panel.people.map((p) => (
              <li key={p.id}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2 text-[0.9375rem] text-ink hover:bg-secondary/60">
                  <input
                    type="checkbox"
                    checked={recipients.includes(p.id)}
                    onChange={(e) => setRecipients((cur) => (e.target.checked ? [...cur, p.id] : cur.filter((x) => x !== p.id)))}
                    className="size-5 accent-[#3E7A3A]"
                  />
                  <span className="min-w-0 break-words">
                    {p.isYou ? "You" : p.name} <span className="text-xs text-muted-foreground">· {p.role}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}

      {preset === "off" ? (
        <p className="text-sm text-muted-foreground">Saving will turn off every reminder for this {isTask ? "task" : "booking"}.</p>
      ) : preview ? (
        <div className="rounded-xl bg-surface-warm p-3" role="status" aria-live="polite">
          <p className="eyebrow text-earth-ink">Preview</p>
          <ul className="mt-1 space-y-1.5">
            {preview.rows.map((row) => (
              <li key={row.recipientId} className={cn("text-sm", row.problem ? "text-[#8c2b1f]" : "text-ink")}>
                {row.text ?? row.problem}
                {row.note ? <span className="text-muted-foreground"> {row.note}</span> : null}
              </li>
            ))}
            {preview.problem ? <li className="text-sm text-[#8c2b1f]">{preview.problem}</li> : null}
          </ul>
        </div>
      ) : null}
      <FormMessage message={error ?? undefined} />
      <div className="flex justify-end">
        <button type="button" disabled={!ready || saving} onClick={save} className={primaryButton}>
          {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <AlarmClock className="size-4" aria-hidden="true" />}
          {preset === "off" ? "Turn off" : "Save reminder"}
        </button>
      </div>
    </section>
  );
}
