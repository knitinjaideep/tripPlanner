"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, Loader2, Moon } from "lucide-react";
import { toast } from "sonner";
import { loadEveningPreview, saveEveningPreview, type EveningSettings } from "@/app/actions/evening-preview";
import { FormMessage, secondaryButtonClass } from "@/components/forms/fields";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { formatTime } from "@/lib/dates";
import { useDisplayPrefs } from "@/components/settings/settings-provider";
import { DEFAULT_SEND_TIME, SEND_TIMES } from "@/lib/evening-preview";
import { timeZoneLabel, zoneAbbreviation } from "@/lib/time-zones";
import { todayInTimeZone } from "@/lib/dates";
import { cn } from "@/lib/utils";

/**
 * "Evening preview" — a member's own, private opt-in for a short preview of
 * tomorrow. Off until they turn it on; the dialog shows exactly what it would
 * say (from the saved plan) before they do, tells the truth about email and
 * about whether scheduled delivery is running, and makes turning it off easy.
 */
export function EveningPreviewButton({ tripId, className }: { tripId: string; className?: string }) {
  const params = useSearchParams();
  const [open, setOpen] = useState(params.get("evening") === "1");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        className={cn("focus-ring inline-flex min-h-11 items-center gap-2 rounded-xl bg-white/90 px-3.5 text-sm font-semibold text-ink hover:bg-white", className)}
      >
        <Moon className="size-4" aria-hidden="true" /> <span className="hidden sm:inline">Evening preview</span>
        <span className="sr-only sm:hidden">Evening preview</span>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-1.5rem)] gap-0 overflow-y-auto rounded-2xl p-0 sm:max-w-md">
        {open ? <Body tripId={tripId} onDone={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Body({ tripId, onDone }: { tripId: string; onDone: () => void }) {
  const { clock: clockPref } = useDisplayPrefs();
  const [settings, setSettings] = useState<EveningSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [time, setTime] = useState(DEFAULT_SEND_TIME);
  const [inApp, setInApp] = useState(true);
  const [email, setEmail] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const result = await loadEveningPreview(tripId);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    const s = result.settings;
    setSettings(s);
    setEnabled(s.prefs.enabled);
    setTime(s.prefs.send_time);
    setInApp(s.prefs.in_app);
    setEmail(s.prefs.email && s.email.providerConfigured && s.email.hasAddress);
  }, [tripId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load when the dialog opens
    void load();
  }, [load]);

  async function save(next: { enabled: boolean }) {
    setSaving(true);
    const result = await saveEveningPreview(tripId, { enabled: next.enabled, send_time: time, in_app: inApp || !email, email });
    setSaving(false);
    if (!result.ok) {
      setError(result.message ?? "Couldn’t save that.");
      return;
    }
    setEnabled(next.enabled);
    toast.success(result.message);
    onDone();
  }

  const zone = settings ? zoneAbbreviation(todayInTimeZone(settings.timeZone), time, settings.timeZone) : null;
  const emailReason = !settings
    ? null
    : !settings.email.providerConfigured
      ? "Email isn’t set up for this app, so previews arrive in your Atlas inbox only."
      : !settings.email.hasAddress
        ? "We don’t have an email address for your account."
        : null;

  return (
    <>
      <DialogHeader className="gap-1 px-5 pt-5 pr-14 pb-3 sm:px-6">
        <DialogTitle className="font-display text-2xl font-semibold text-ink">Evening preview</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          Once each evening of the trip, a short look at tomorrow — and at most one question still waiting for your answer. Only you see this setting.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-5 px-5 pb-5 sm:px-6">
        {error ? <FormMessage message={error} /> : null}
        {!settings && !error ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading…
          </p>
        ) : null}
        {settings ? (
          <>
            {!settings.scheduler.active ? (
              <p className="flex items-start gap-2.5 rounded-xl border border-gold/60 bg-gold-soft/60 p-3 text-sm text-ink">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>
                  Scheduled delivery isn’t running for this app yet, so nothing will arrive until the app’s owner switches it on. You can still save your choice now.
                </span>
              </p>
            ) : null}

            <section aria-labelledby="ep-sample" className="rounded-2xl border border-border bg-surface p-4">
              <h3 id="ep-sample" className="eyebrow text-muted-foreground">
                What it would say{settings.sample ? ` · ${settings.sample.isTomorrow ? "tomorrow" : "the first day"}` : ""}
              </h3>
              {settings.sample ? (
                <div className="mt-2 space-y-2">
                  <p className="font-display text-lg font-semibold text-ink">{settings.sample.title}</p>
                  <p className="text-[0.9375rem] break-words text-ink/90">{settings.sample.body}</p>
                  <p className="inline-flex min-h-9 items-center rounded-lg bg-moss-ink px-3 text-sm font-semibold text-white">{settings.sample.action}</p>
                  <p className="text-xs text-muted-foreground">
                    A sample from your plan as it is now — nothing was sent. A real one is a snapshot from when it’s sent; its link opens the latest plan.
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">There’s no upcoming day to preview — this trip has ended or has no days left.</p>
              )}
            </section>

            <label className="flex min-h-11 cursor-pointer items-start gap-3 text-[0.9375rem] text-ink">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="mt-1 size-5 accent-[#3E7A3A]" />
              <span>
                <span className="font-semibold">Send me an evening preview of tomorrow</span>
                <span className="block text-sm text-muted-foreground">Only on trip evenings — including the evening before the first day.</span>
              </span>
            </label>

            <div className={cn("space-y-4", !enabled && "opacity-60")}>
              <div className="space-y-1.5">
                <label htmlFor="ep-time" className="text-sm font-semibold text-ink">Send at</label>
                <select
                  id="ep-time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  disabled={!enabled}
                  className="h-11 w-full rounded-[10px] border border-input bg-white px-3 text-[0.9375rem] text-ink"
                >
                  {SEND_TIMES.map((t) => (
                    <option key={t} value={t}>{formatTime(t, clockPref)}{t === DEFAULT_SEND_TIME ? " (suggested)" : ""}</option>
                  ))}
                </select>
                <p className="text-sm text-muted-foreground">
                  Trip time: {timeZoneLabel(settings.timeZone)}{zone ? ` (${zone})` : ""} — not your phone’s time zone.
                </p>
              </div>

              <fieldset className="space-y-1">
                <legend className="text-sm font-semibold text-ink">Where</legend>
                <label className="flex min-h-11 items-center gap-3 text-sm text-ink">
                  <input type="checkbox" checked={inApp} disabled={!enabled || (!email && inApp)} onChange={(e) => setInApp(e.target.checked)} className="size-5 accent-[#3E7A3A]" />
                  In my Atlas inbox
                </label>
                <label className="flex min-h-11 items-center gap-3 text-sm text-ink">
                  <input type="checkbox" checked={email} disabled={!enabled || emailReason !== null} onChange={(e) => setEmail(e.target.checked)} className="size-5 accent-[#3E7A3A]" />
                  By email
                </label>
                {emailReason ? <p className="text-sm text-muted-foreground">{emailReason}</p> : <p className="text-sm text-muted-foreground">The email holds the same short text and a sign-in link — no addresses, booking numbers or documents.</p>}
              </fieldset>
            </div>
          </>
        ) : null}
      </div>
      <div className="sticky bottom-0 flex flex-col-reverse gap-2 border-t border-border bg-background px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end sm:px-6">
        {settings?.prefs.enabled ? (
          <button type="button" onClick={() => void save({ enabled: false })} disabled={saving} className={secondaryButtonClass}>
            Turn off previews
          </button>
        ) : (
          <button type="button" onClick={onDone} className={secondaryButtonClass}>Cancel</button>
        )}
        <button
          type="button"
          disabled={!settings || saving}
          onClick={() => void save({ enabled })}
          className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-moss-ink px-5 text-[0.9375rem] font-semibold text-white hover:bg-moss-hover disabled:opacity-60"
        >
          {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </>
  );
}
