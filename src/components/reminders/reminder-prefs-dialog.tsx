"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { loadReminderPrefs, saveReminderPrefs } from "@/app/actions/reminders";
import { FormMessage, secondaryButtonClass } from "@/components/forms/fields";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ReminderPrefs } from "@/lib/reminders";
import { timeZoneLabel } from "@/lib/time-zones";
import { cn } from "@/lib/utils";

type Loaded = {
  prefs: ReminderPrefs;
  email: { providerConfigured: boolean; hasAddress: boolean };
  scheduler: { active: boolean; lastRunAt: string | null };
};

/**
 * A person's OWN delivery settings for reminders, across every trip: whether
 * they receive them at all, inbox / email, quiet hours, and the time of day
 * offered for tasks that only have a date. Only they can see or change this.
 */
export function ReminderPrefsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-1.5rem)] gap-0 overflow-y-auto rounded-2xl p-0 sm:max-w-md">
        {open ? <Body onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Body({ onDone }: { onDone: () => void }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [p, setP] = useState<ReminderPrefs | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const result = await loadReminderPrefs();
    if (!result.ok || !result.data) {
      setError(result.message ?? "Couldn’t load your settings.");
      return;
    }
    setLoaded(result.data);
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setP({ ...result.data.prefs, quiet_zone: result.data.prefs.quiet_zone ?? browserZone });
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load when the dialog opens
    void load();
  }, [load]);

  async function save() {
    if (!p) return;
    setSaving(true);
    setError(null);
    const emailOk = loaded?.email.providerConfigured && loaded.email.hasAddress;
    const result = await saveReminderPrefs({ ...p, email: p.email && Boolean(emailOk), in_app: p.in_app || !(p.email && emailOk) });
    setSaving(false);
    if (!result.ok) {
      setError(result.message ?? "Couldn’t save that.");
      return;
    }
    toast.success(result.message);
    onDone();
  }

  const emailReason = !loaded ? null : !loaded.email.providerConfigured ? "Email isn’t set up for this app, so reminders arrive in your Atlas inbox only." : !loaded.email.hasAddress ? "We don’t have an email address for your account." : null;
  const set = (patch: Partial<ReminderPrefs>) => setP((cur) => (cur ? { ...cur, ...patch } : cur));

  return (
    <>
      <DialogHeader className="gap-1 px-5 pt-5 pr-14 pb-3 sm:px-6">
        <DialogTitle className="font-display text-2xl font-semibold text-ink">Your reminder settings</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          How reminders reach you, on every trip. Only you see or change these — trip editors can set a reminder up, but you decide whether and how it arrives.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-5 px-5 pb-5 sm:px-6">
        {error ? <FormMessage message={error} /> : null}
        {!p && !error ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading…
          </p>
        ) : null}
        {p && loaded ? (
          <>
            {!loaded.scheduler.active ? (
              <p className="flex items-start gap-2.5 rounded-xl border border-gold/60 bg-gold-soft/60 p-3 text-sm text-ink">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>Scheduled delivery isn’t running for this app yet, so nothing will arrive until the app’s owner switches it on.</span>
              </p>
            ) : null}
            <label className="flex min-h-11 cursor-pointer items-start gap-3 text-[0.9375rem] text-ink">
              <input type="checkbox" checked={p.enabled} onChange={(e) => set({ enabled: e.target.checked })} className="mt-1 size-5 accent-[#3E7A3A]" />
              <span>
                <span className="font-semibold">Send me reminders</span>
                <span className="block text-sm text-muted-foreground">Turning this off cancels the reminders waiting for you; turning it back on restores the ones still ahead.</span>
              </span>
            </label>
            <fieldset disabled={!p.enabled} className={cn("space-y-4", !p.enabled && "opacity-60")}>
              <legend className="mb-1 text-sm font-semibold text-ink">Where</legend>
              <label className="flex min-h-11 items-center gap-3 text-[0.9375rem] text-ink">
                <input type="checkbox" checked={p.in_app} onChange={(e) => set({ in_app: e.target.checked })} className="size-5 accent-[#3E7A3A]" /> Atlas inbox
              </label>
              <div>
                <label className={cn("flex min-h-11 items-center gap-3 text-[0.9375rem] text-ink", emailReason && "opacity-60")}>
                  <input type="checkbox" checked={p.email && !emailReason} disabled={Boolean(emailReason)} onChange={(e) => set({ email: e.target.checked })} className="size-5 accent-[#3E7A3A]" /> Email too
                </label>
                {emailReason ? <p className="ml-8 text-sm text-muted-foreground">{emailReason}</p> : <p className="ml-8 text-sm text-muted-foreground">Just the one line and a link that asks you to sign in. No confirmation numbers.</p>}
              </div>
              <div>
                <label className="flex min-h-11 items-center gap-3 text-[0.9375rem] text-ink">
                  <input type="checkbox" checked={p.quiet_enabled} onChange={(e) => set({ quiet_enabled: e.target.checked })} className="size-5 accent-[#3E7A3A]" /> Quiet hours
                </label>
                {p.quiet_enabled ? (
                  <div className="ml-8 space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-sm text-ink">
                      <input aria-label="Quiet hours start" type="time" value={p.quiet_start} onChange={(e) => set({ quiet_start: e.target.value })} className="h-11 rounded-[10px] border border-input bg-white px-3 text-[0.9375rem]" />
                      <span>to</span>
                      <input aria-label="Quiet hours end" type="time" value={p.quiet_end} onChange={(e) => set({ quiet_end: e.target.value })} className="h-11 rounded-[10px] border border-input bg-white px-3 text-[0.9375rem]" />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      In {timeZoneLabel(p.quiet_zone ?? "UTC")}. A booking reminder that lands in them is moved earlier when that’s still useful, otherwise it isn’t sent unless you allow it. A task reminder waits until they end. You’ll always be told.
                    </p>
                  </div>
                ) : null}
              </div>
              <div>
                <label htmlFor="rp-task-time" className="mb-1 block text-sm font-semibold text-ink">
                  Time of day offered for tasks that only have a date
                </label>
                <input id="rp-task-time" type="time" value={p.default_task_time} onChange={(e) => set({ default_task_time: e.target.value })} className="h-11 rounded-[10px] border border-input bg-white px-3 text-[0.9375rem]" />
                <p className="mt-1 text-xs text-muted-foreground">It’s offered when someone sets a reminder up — it’s never applied silently.</p>
              </div>
            </fieldset>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button type="button" onClick={onDone} className={secondaryButtonClass} disabled={saving}>
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-moss-ink px-5 text-[0.9375rem] font-semibold text-white hover:bg-moss-hover disabled:opacity-60"
              >
                {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null} Save settings
              </button>
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}
