"use client";

import { useId, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { createPoll, updatePoll } from "@/app/actions/polls";
import { FormMessage, controlClass, secondaryButtonClass } from "@/components/forms/fields";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useTripAccess } from "@/components/trip/trip-access";
import { POLL_LIMITS, parentLabel, type PollView } from "@/lib/polls";
import { timeZoneLabel, zoneAbbreviation } from "@/lib/time-zones";
import { cn } from "@/lib/utils";

export type PollParent =
  | { type: "trip" }
  | { type: "day"; day: string }
  | { type: "activity"; item_id: string }
  | { type: "place"; place_id: string };

export type PollFormMode =
  | { kind: "new"; parent: PollParent; seedPlaceId?: string }
  | { kind: "edit"; poll: PollView }
  | { kind: "revise"; poll: PollView };

type Option = { key: number; label: string; place_id: string };

const fieldLabel = "text-sm font-semibold text-ink";

/**
 * "Ask the group": a question, two or three options (plain text or a saved
 * Explore place of this trip), an optional deadline in the TRIP's zone, and
 * who is asked. Asking people never adds anyone to the trip.
 */
export function PollFormDialog({
  mode,
  open,
  onOpenChange,
  places,
  tripTimeZone,
  scopeLabel,
}: {
  mode: PollFormMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  places: { id: string; name: string }[];
  tripTimeZone: string;
  /** What this question is about, e.g. "For Fri, Oct 16" — shown, not editable. */
  scopeLabel?: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-1.5rem)] gap-0 overflow-y-auto rounded-2xl p-0 sm:max-w-lg">
        {open ? (
          <FormBody
            mode={mode}
            places={places}
            tripTimeZone={tripTimeZone}
            scopeLabel={scopeLabel}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function FormBody({
  mode,
  places,
  tripTimeZone,
  scopeLabel,
  onDone,
}: {
  mode: PollFormMode;
  places: { id: string; name: string }[];
  tripTimeZone: string;
  scopeLabel?: string | null;
  onDone: () => void;
}) {
  const uid = useId();
  const { people, userId, role, tripId } = useTripAccess();
  const existing = mode.kind === "new" ? null : mode.poll;
  const parent: PollParent =
    mode.kind === "new"
      ? mode.parent
      : mode.poll.parent.type === "day" && mode.poll.parent.day
        ? { type: "day", day: mode.poll.parent.day }
        : mode.poll.parent.type === "activity" && mode.poll.parent.item
          ? { type: "activity", item_id: mode.poll.parent.item.id }
          : mode.poll.parent.type === "place" && mode.poll.parent.place
            ? { type: "place", place_id: mode.poll.parent.place.id }
            : { type: "trip" };

  const [question, setQuestion] = useState(existing?.question ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [options, setOptions] = useState<Option[]>(() => {
    if (existing) return existing.options.map((o, i) => ({ key: i, label: o.place ? "" : o.label, place_id: o.place?.id ?? "" }));
    const seed = mode.kind === "new" ? mode.seedPlaceId : undefined;
    return [
      { key: 0, label: "", place_id: seed ?? "" },
      { key: 1, label: "", place_id: "" },
    ];
  });
  const [nextKey, setNextKey] = useState(10);
  const [anyOption, setAnyOption] = useState(existing?.any_option ?? true);
  const [hasDeadline, setHasDeadline] = useState(Boolean(existing?.closes_at) && mode.kind === "edit");
  const [closeDate, setCloseDate] = useState(() => (existing?.closes_at && mode.kind === "edit" ? localParts(existing.closes_at, tripTimeZone).date : ""));
  const [closeTime, setCloseTime] = useState(() => (existing?.closes_at && mode.kind === "edit" ? localParts(existing.closes_at, tripTimeZone).time : "17:00"));
  const others = Object.entries(people).filter(([id]) => id !== userId);
  const [asked, setAsked] = useState<Set<string>>(
    () => new Set(existing ? existing.participants.map((p) => p.user_id).filter((id) => id !== userId) : others.map(([id]) => id)),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const zone = closeDate ? zoneAbbreviation(closeDate, closeTime || "12:00", tripTimeZone) : null;
  const canOnlyAskOwner = role !== "owner" && role !== "editor";
  const title = mode.kind === "edit" ? "Edit your question" : mode.kind === "revise" ? "Create a revised poll" : "Ask the group";

  const setOption = (key: number, patch: Partial<Option>) => setOptions((cur) => cur.map((o) => (o.key === key ? { ...o, ...patch } : o)));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(undefined);
    const payload = {
      question,
      description: description.trim() || null,
      options: options.map((o) => ({ label: o.label, place_id: o.place_id || null })),
      any_option: anyOption,
      closes: hasDeadline && closeDate ? { date: closeDate, time: closeTime } : null,
      parent,
      participant_ids: others.length > 0 && asked.size === others.length ? null : [...asked],
      replaces_poll_id: mode.kind === "revise" ? mode.poll.id : null,
    };
    const result =
      mode.kind === "edit" ? await updatePoll(tripId, mode.poll.id, payload) : await createPoll(tripId, payload);
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    toast.success(mode.kind === "edit" ? "Question updated." : mode.kind === "revise" ? "Revised question sent. The original was canceled." : "Question sent to the group.");
    onDone();
  }

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-col" aria-busy={pending}>
      <DialogHeader className="gap-1 px-5 pt-5 pr-14 pb-3 sm:px-6">
        <DialogTitle className="font-display text-2xl font-semibold text-ink">{title}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {mode.kind === "revise"
            ? "People have already answered, so this starts a new question and cancels the original."
            : "A quick question for everyone on the trip. Answers are visible to the group."}
          {scopeLabel ? <span className="mt-1 block font-medium text-ink">{scopeLabel}</span> : null}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-5 px-5 pb-5 sm:px-6">
        <FormMessage message={error} />
        <div className="space-y-1.5">
          <label htmlFor={`${uid}-q`} className={fieldLabel}>Question</label>
          <Input
            id={`${uid}-q`}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={POLL_LIMITS.question}
            placeholder="Where should we eat on Friday?"
            className={controlClass}
            required
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${uid}-d`} className={fieldLabel}>
            Details <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <Textarea
            id={`${uid}-d`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={POLL_LIMITS.description}
            rows={2}
            className="rounded-[10px] border-input bg-white text-[0.9375rem]"
          />
        </div>

        <fieldset className="space-y-3">
          <legend className={fieldLabel}>Options <span className="font-normal text-muted-foreground">(2–3)</span></legend>
          {options.map((o, i) => (
            <div key={o.key} className="rounded-xl border border-border bg-surface p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 space-y-2">
                  <Input
                    aria-label={`Option ${i + 1}`}
                    value={o.place_id ? (places.find((p) => p.id === o.place_id)?.name ?? "") : o.label}
                    readOnly={Boolean(o.place_id)}
                    onChange={(e) => setOption(o.key, { label: e.target.value })}
                    maxLength={POLL_LIMITS.option}
                    placeholder={i === 0 ? "Friday" : i === 1 ? "Saturday" : "Another idea"}
                    className={cn(controlClass, o.place_id && "bg-secondary")}
                  />
                  {places.length > 0 ? (
                    <select
                      aria-label={`Option ${i + 1}: use a saved Explore place`}
                      value={o.place_id}
                      onChange={(e) => setOption(o.key, { place_id: e.target.value, label: "" })}
                      className={cn(controlClass, "w-full border px-3")}
                    >
                      <option value="">Type my own text</option>
                      {places.map((p) => (
                        <option key={p.id} value={p.id}>{`From Explore: ${p.name}`}</option>
                      ))}
                    </select>
                  ) : null}
                </div>
                {options.length > POLL_LIMITS.minOptions ? (
                  <button
                    type="button"
                    onClick={() => setOptions((cur) => cur.filter((x) => x.key !== o.key))}
                    aria-label={`Remove option ${i + 1}`}
                    className="focus-ring grid size-11 shrink-0 place-items-center rounded-xl text-muted-foreground hover:bg-secondary hover:text-ink"
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          {options.length < POLL_LIMITS.maxOptions ? (
            <button
              type="button"
              onClick={() => {
                setOptions((cur) => [...cur, { key: nextKey, label: "", place_id: "" }]);
                setNextKey((k) => k + 1);
              }}
              className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-semibold text-moss-ink hover:bg-moss-soft"
            >
              <Plus className="size-4" aria-hidden="true" /> Add an option
            </button>
          ) : null}
          <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl p-1 text-sm text-ink">
            <input type="checkbox" checked={anyOption} onChange={(e) => setAnyOption(e.target.checked)} className="mt-1 size-5 accent-[#3E7A3A]" />
            <span>
              Offer “Any works for me”
              <span className="block text-muted-foreground">A separate answer for people who don’t mind. It doesn’t count as a vote for any option.</span>
            </span>
          </label>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className={fieldLabel}>Closing time</legend>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink">
            <input type="checkbox" checked={hasDeadline} onChange={(e) => setHasDeadline(e.target.checked)} className="size-5 accent-[#3E7A3A]" />
            Close automatically at a set time
          </label>
          {hasDeadline ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-3">
                <Input
                  type="date"
                  aria-label="Closing date"
                  value={closeDate}
                  onChange={(e) => setCloseDate(e.target.value)}
                  className={controlClass}
                />
                <Input type="time" aria-label="Closing time" value={closeTime} onChange={(e) => setCloseTime(e.target.value)} className={controlClass} />
              </div>
              <p className="text-sm text-muted-foreground">
                Times are in the trip’s time zone: {timeZoneLabel(tripTimeZone)}
                {zone ? ` (${zone})` : ""}.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No closing time: it stays open until someone closes it.</p>
          )}
        </fieldset>

        <fieldset className="space-y-1">
          <legend className={fieldLabel}>Who’s being asked</legend>
          {others.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nobody else is on this trip yet. Invite people from “Share” first — asking never adds anyone.</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">Current members of this trip. You’re always included.</p>
              <ul className="mt-1">
                {others.map(([id, name]) => (
                  <li key={id}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink">
                      <input
                        type="checkbox"
                        checked={asked.has(id)}
                        onChange={(e) =>
                          setAsked((cur) => {
                            const next = new Set(cur);
                            if (e.target.checked) next.add(id);
                            else next.delete(id);
                            return next;
                          })
                        }
                        className="size-5 accent-[#3E7A3A]"
                      />
                      {name}
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </fieldset>
        {canOnlyAskOwner ? <p className="text-sm text-muted-foreground">Only owners and editors can ask the group.</p> : null}
      </div>

      <div className="sticky bottom-0 flex flex-col-reverse gap-2 border-t border-border bg-background px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end sm:px-6">
        <button type="button" onClick={onDone} className={secondaryButtonClass}>Cancel</button>
        <button
          type="submit"
          disabled={pending || others.length === 0 || asked.size === 0}
          className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-moss-ink px-5 text-[0.9375rem] font-semibold text-white hover:bg-moss-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {pending ? "Sending…" : mode.kind === "edit" ? "Save changes" : mode.kind === "revise" ? "Send revised question" : "Ask the group"}
        </button>
      </div>
      <span className="sr-only">{parentLabel(existing?.parent ?? { type: "trip", day: null, item: null, place: null, missing: false })}</span>
    </form>
  );
}

function localParts(iso: string, zone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}
