"use client";

import { Suspense, use, useState, useTransition } from "react";
import Link from "next/link";
import {
  CalendarCheck2,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Info,
  Loader2,
  OctagonX,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import {
  applyItineraryPlan,
  previewItineraryPlan,
  type PlanApplySummary,
  type PlanOtherTrip,
  type PlanPreviewResult,
  type PlanPreviewState,
} from "@/app/actions/itinerary-plan";
import { secondaryButtonClass } from "@/components/forms/fields";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatDateRange, formatShortDay, formatTime } from "@/lib/dates";
import { itineraryHref } from "@/lib/itinerary-format";
import type { PlanChoice, PlanNotice, PlanOp, PlanPreview } from "@/lib/plans/itinerary-plan";
import { cn } from "@/lib/utils";

type Pending = Pick<PlanPreview["counts"], "add" | "update" | "remove" | "conflict">;

const primary =
  "focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-moss-ink px-5 text-[0.9375rem] font-semibold text-white shadow-[0_6px_16px_-8px_rgba(62,122,58,0.55)] transition-colors hover:bg-moss-hover disabled:cursor-not-allowed disabled:opacity-60";

/**
 * "Update <plan>" for a trip the saved plan fits. The card only opens a
 * read-only preview; nothing is written until Apply, which sends the
 * preview's token so the server applies exactly what was shown.
 */
export function PlanUpdateCard({
  tripId,
  planId,
  label,
  pending,
}: {
  tripId: string;
  planId: string;
  label: string;
  pending: Pending;
}) {
  const [open, setOpen] = useState(false);
  // Created on click (never during render); a retry or reopen makes a fresh request.
  const [request, setRequest] = useState<{ id: number; promise: Promise<PlanPreviewState> } | null>(null);
  const total = pending.add + pending.update + pending.remove + pending.conflict;
  const review = () => {
    setRequest((prev) => ({ id: (prev?.id ?? 0) + 1, promise: previewItineraryPlan(tripId, planId) }));
    setOpen(true);
  };

  return (
    <>
      {total > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-gold/50 bg-surface p-4 shadow-[0_10px_28px_-18px_rgba(139,111,71,0.45)]">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-gold-soft text-gold-ink">
            <Sparkles className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-ink">Update {label}</p>
            <p className="text-sm text-muted-foreground">{pendingText(pending)} — review before anything is saved.</p>
          </div>
          <button type="button" onClick={review} className={primary}>
            Review update
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={review}
          className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-ink"
        >
          <CalendarCheck2 className="size-4 text-moss-ink" aria-hidden="true" /> {label} is up to date · Review
        </button>
      )}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="w-full gap-0 bg-background p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
        >
          <SheetHeader className="gap-1 px-5 pt-5 pb-4 pr-16 sm:px-6">
            <SheetTitle className="font-display text-2xl leading-tight font-semibold text-ink">Update {label}</SheetTitle>
            <SheetDescription className="text-sm text-muted-foreground">
              A preview of what changes. Times are planning estimates; flights and the stay come from your bookings.
            </SheetDescription>
          </SheetHeader>
          {open && request ? (
            <Suspense
              fallback={
                <p className="flex items-center gap-2 px-5 text-sm text-muted-foreground sm:px-6" role="status">
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Comparing with your itinerary…
                </p>
              }
            >
              <PlanPreviewPanel
                key={request.id}
                request={request.promise}
                tripId={tripId}
                planId={planId}
                onRetry={review}
                onClose={() => setOpen(false)}
              />
            </Suspense>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

function pendingText(p: Pending) {
  const parts = [
    p.add && `${p.add} to add`,
    p.update && `${p.update} to update`,
    p.remove && `${p.remove} outdated`,
    p.conflict && `${p.conflict} need${p.conflict === 1 ? "s" : ""} your choice`,
  ].filter(Boolean);
  return parts.join(" · ");
}

type Loaded = { preview: PlanPreviewResult; otherTrips: PlanOtherTrip[] };

function PlanPreviewPanel({
  request,
  tripId,
  planId,
  onRetry,
  onClose,
}: {
  request: Promise<PlanPreviewState>;
  tripId: string;
  planId: string;
  onRetry: () => void;
  onClose: () => void;
}) {
  const initial = use(request);
  const [loaded, setLoaded] = useState<Loaded | null>(() =>
    initial.ok && initial.preview ? { preview: initial.preview, otherTrips: initial.otherTrips ?? [] } : null,
  );
  const [error, setError] = useState<string | null>(initial.ok ? null : (initial.message ?? "Couldn’t load the preview."));
  const [choices, setChoices] = useState<Record<string, PlanChoice>>({});
  const [setZone, setSetZone] = useState(false);
  const [summary, setSummary] = useState<{ message: string; summary: PlanApplySummary } | null>(null);
  const [applying, startApplying] = useTransition();

  const apply = () => {
    if (!loaded || applying) return;
    startApplying(async () => {
      setError(null);
      const result = await applyItineraryPlan(tripId, {
        plan_id: planId,
        token: loaded.preview.token,
        choices,
        set_trip_time_zone: setZone,
      });
      if (result.ok && result.summary) {
        setSummary({ message: result.message ?? "Saved.", summary: result.summary });
        toast.success(result.message);
      } else {
        // A stale preview comes back refreshed; choices for entries still in conflict are kept.
        if (result.preview) setLoaded({ preview: result.preview, otherTrips: loaded.otherTrips });
        setError(result.message ?? "Couldn’t save the update. Nothing was changed.");
      }
    });
  };

  if (summary) {
    const s = summary.summary;
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto px-5 pb-6 sm:px-6">
          <div className="rounded-2xl border border-border bg-moss-soft/50 p-4">
            <p className="flex items-center gap-2 font-semibold text-ink">
              <CircleCheck className="size-5 text-moss-ink" aria-hidden="true" /> Saved
            </p>
            <p className="mt-1 text-sm text-ink/80">{summary.message}</p>
          </div>
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            {(
              [
                ["Added", s.added],
                ["Updated", s.updated],
                ["Removed", s.removed],
                ["Linked", s.linked],
                ["Kept as yours", s.kept],
                ["Already current", s.unchanged],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="rounded-xl border border-border bg-surface px-3 py-2">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="text-lg font-semibold text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="flex justify-end border-t border-border bg-surface px-5 py-4 sm:px-6">
          <button type="button" onClick={onClose} className={primary}>
            Done
          </button>
        </div>
      </div>
    );
  }

  const preview = loaded?.preview;
  const conflicts = preview?.ops.filter((o): o is Extract<PlanOp, { kind: "conflict" }> => o.kind === "conflict") ?? [];
  const changes = preview?.ops.filter((o): o is ChangeOp => o.kind !== "conflict" && o.kind !== "unchanged") ?? [];
  const willChange =
    changes.length > 0 || conflicts.some((c) => choices[c.id] === "plan") || (setZone && Boolean(preview?.zoneOption));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-6 overflow-y-auto px-5 pb-6 sm:px-6">
        {error ? (
          <p role="alert" className="rounded-xl border border-destructive/30 bg-[#fff1ee] px-3.5 py-2.5 text-sm text-[#8c2b1f]">
            {error}
          </p>
        ) : null}

        {!preview ? (
          <button type="button" onClick={onRetry} className={secondaryButtonClass}>
            <RefreshCw className="size-4" aria-hidden="true" /> Try again
          </button>
        ) : (
          <>
            <Counts preview={preview} />

            {loaded.otherTrips.length > 0 ? (
              <div className="rounded-xl border border-border bg-surface p-3.5 text-sm">
                <p className="font-semibold text-ink">You have other trips this plan could fit</p>
                <p className="mt-0.5 text-muted-foreground">This update only touches the trip you’re viewing.</p>
                <ul className="mt-2 space-y-1">
                  {loaded.otherTrips.map((t) => (
                    <li key={t.id}>
                      <Link href={itineraryHref(t.id, t.start_date)} className="font-semibold text-moss-ink hover:underline">
                        {t.title}
                      </Link>{" "}
                      <span className="text-muted-foreground">· {formatDateRange(t.start_date, t.end_date, "short")}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <Notices notices={preview.notices} />

            {conflicts.length > 0 ? (
              <section aria-labelledby="plan-conflicts" className="space-y-3">
                <h3 id="plan-conflicts" className="eyebrow text-ink">
                  Needs your choice · {conflicts.length}
                </h3>
                <p className="-mt-1 text-sm text-muted-foreground">
                  These involve your own edits or outdated entries. Leaving “Keep mine” changes nothing.
                </p>
                {conflicts.map((c) => (
                  <ConflictRow
                    key={c.id}
                    conflict={c}
                    choice={choices[c.id] ?? "keep"}
                    onChoose={(v) => setChoices((prev) => ({ ...prev, [c.id]: v }))}
                  />
                ))}
              </section>
            ) : null}

            {changes.length > 0 ? <ChangesByDay ops={changes} /> : null}

            {preview.zoneOption ? (
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-input bg-white p-3.5">
                <input
                  type="checkbox"
                  checked={setZone}
                  onChange={(e) => setSetZone(e.target.checked)}
                  className="mt-0.5 size-5 shrink-0 accent-moss"
                />
                <span>
                  <span className="block text-sm font-semibold text-ink">
                    Also set this trip’s time zone to {preview.zoneOption.planned}
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    Currently {preview.zoneOption.current}.{" "}
                    {preview.zoneOption.sameClock ? "Same clock on these dates — nothing shifts." : "The clocks differ on these dates."} Bookings keep their own zones.
                  </span>
                </span>
              </label>
            ) : null}
          </>
        )}
      </div>

      <div className="flex flex-col-reverse gap-3 border-t border-border bg-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-6">
        <button type="button" onClick={onClose} className={secondaryButtonClass} disabled={applying}>
          Cancel
        </button>
        {preview ? (
          <button
            type="button"
            onClick={apply}
            disabled={applying || preview.blocked || !willChange}
            aria-busy={applying}
            className={primary}
          >
            {applying ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            {applying ? "Saving…" : preview.blocked ? "Can’t apply yet" : willChange ? "Apply update" : "Nothing to change"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Counts({ preview }: { preview: PlanPreview }) {
  const c = preview.counts;
  const items = [
    ["to add", c.add],
    ["to update", c.update],
    ["outdated", c.remove],
    ["need a choice", c.conflict],
    ["already there", c.unchanged + c.link],
  ] as const;
  return (
    <ul className="flex flex-wrap gap-2 text-sm">
      {items
        .filter(([, n]) => n > 0)
        .map(([label, n]) => (
          <li key={label} className="rounded-full border border-border bg-surface px-3 py-1 text-ink">
            <span className="font-semibold">{n}</span> {label}
          </li>
        ))}
    </ul>
  );
}

const NOTICE_STYLE: Record<PlanNotice["level"], { icon: typeof Info; className: string }> = {
  blocker: { icon: OctagonX, className: "text-[#8c2b1f]" },
  warning: { icon: CircleAlert, className: "text-gold-ink" },
  info: { icon: Info, className: "text-info-ink" },
  ok: { icon: CircleCheck, className: "text-moss-ink" },
};

function NoticeRow({ notice }: { notice: PlanNotice }) {
  const { icon: Icon, className } = NOTICE_STYLE[notice.level];
  return (
    <li className="flex gap-2.5">
      <Icon className={cn("mt-0.5 size-4 shrink-0", className)} aria-hidden="true" />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{notice.title}</span>
        {notice.detail ? <span className="block text-sm text-muted-foreground">{notice.detail}</span> : null}
      </span>
    </li>
  );
}

function Notices({ notices }: { notices: PlanNotice[] }) {
  const order: PlanNotice["level"][] = ["blocker", "warning", "info"];
  const important = order.flatMap((level) => notices.filter((n) => n.level === level));
  const ok = notices.filter((n) => n.level === "ok");
  return (
    <section aria-labelledby="plan-checks" className="space-y-3">
      <h3 id="plan-checks" className="eyebrow text-ink">
        Trip & booking checks
      </h3>
      {important.length ? <ul className="space-y-3">{important.map((n) => <NoticeRow key={n.title} notice={n} />)}</ul> : null}
      {ok.length ? (
        <details className="group rounded-xl border border-border bg-surface px-3.5">
          <summary className="focus-ring flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-lg text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-2">
              <CircleCheck className="size-4 text-moss-ink" aria-hidden="true" /> {ok.length} {ok.length === 1 ? "check" : "checks"} passed
            </span>
            <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden="true" />
          </summary>
          <ul className="space-y-2 pb-3">{ok.map((n) => <NoticeRow key={n.title} notice={n} />)}</ul>
        </details>
      ) : null}
    </section>
  );
}

const REASON: Record<Extract<PlanOp, { kind: "conflict" }>["reason"], string> = {
  edited: "You edited this plan entry.",
  reviewed: "Already marked done/skipped or reflected on.",
  match: "Looks like an entry you added yourself.",
  retire: "Not part of the new plan.",
};

function span(start: string | null, end: string | null) {
  if (!start) return "Flexible";
  return end ? `${formatTime(start)} – ${formatTime(end)}` : `${formatTime(start)} onward`;
}

function ConflictRow({
  conflict: c,
  choice,
  onChoose,
}: {
  conflict: Extract<PlanOp, { kind: "conflict" }>;
  choice: PlanChoice;
  onChoose: (choice: PlanChoice) => void;
}) {
  const name = `plan-choice-${c.id}`;
  return (
    <fieldset className="rounded-xl border border-border bg-surface p-3.5">
      <legend className="sr-only">{c.title}</legend>
      <p className="font-semibold text-ink">{c.title}</p>
      <p className="text-sm text-muted-foreground">
        {c.date ? formatShortDay(c.date) : "No date"} · {c.label ?? REASON[c.reason]}
      </p>
      {c.item ? (
        <p className="mt-1 text-sm text-ink/80">
          Plan: {c.item.title} · {span(c.item.start, c.item.end)}
          {c.changes.length ? <span className="text-muted-foreground"> (differs in {c.changes.join(", ")})</span> : null}
        </p>
      ) : null}
      {c.kept.length ? (
        <p className="mt-1 text-sm text-muted-foreground">Always kept: {c.kept.join(", ")}.</p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {(
          [
            ["keep", "Keep mine"],
            ["plan", c.reason === "retire" ? "Remove it" : "Use the plan"],
          ] as const
        ).map(([value, text]) => (
          <label key={value} className="cursor-pointer">
            <input
              type="radio"
              name={name}
              value={value}
              checked={choice === value}
              onChange={() => onChoose(value)}
              className="peer sr-only"
            />
            <span className="inline-flex min-h-10 items-center rounded-lg border border-input bg-white px-3 text-sm font-medium text-ink peer-checked:border-moss peer-checked:bg-moss-soft peer-checked:text-moss-ink peer-focus-visible:ring-3 peer-focus-visible:ring-moss/40">
              {text}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

type ChangeOp = Exclude<PlanOp, { kind: "conflict" | "unchanged" }>;

function ChangesByDay({ ops }: { ops: ChangeOp[] }) {
  const rows = ops.map((op) => {
    if (op.kind === "remove") return { date: op.date, start: null, end: null, title: op.title, tag: "Remove", note: op.label };
    const tag = op.kind === "add" ? "Add" : op.kind === "update" ? "Update" : "Link";
    const note =
      op.kind === "update" ? `Changes ${op.changes.join(", ")}` : op.kind === "add" && op.placeName ? `Linked to Explore: ${op.placeName}` : op.kind === "link" ? "Already on your itinerary" : null;
    return { date: op.item.date, start: op.item.start, end: op.item.end, title: op.item.title, tag, note };
  });
  const days = [...new Set(rows.map((r) => r.date))].sort();
  return (
    <section aria-labelledby="plan-changes" className="space-y-2">
      <h3 id="plan-changes" className="eyebrow text-ink">
        Changes by day
      </h3>
      {days.map((date) => {
        const list = rows.filter((r) => r.date === date);
        return (
          <details key={date} className="group rounded-xl border border-border bg-surface px-3.5">
            <summary className="focus-ring flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-lg text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
              <span>
                {date ? formatShortDay(date) : "No date"}
                <span className="ml-1.5 font-normal text-muted-foreground">· {list.length}</span>
              </span>
              <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden="true" />
            </summary>
            <ul className="space-y-1.5 pb-3 text-sm">
              {list.map((r, i) => (
                <li key={`${r.title}-${i}`} className="flex gap-2">
                  <span
                    className={cn(
                      "mt-0.5 inline-flex h-5 shrink-0 items-center rounded px-1.5 text-[0.6875rem] font-semibold uppercase",
                      r.tag === "Remove" ? "bg-[#fff1ee] text-[#8c2b1f]" : "bg-moss-soft text-moss-ink",
                    )}
                  >
                    {r.tag}
                  </span>
                  <span className="min-w-0">
                    <span className="text-muted-foreground">{span(r.start, r.end)}</span> · <span className="text-ink">{r.title}</span>
                    {r.note ? <span className="block text-muted-foreground">{r.note}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </section>
  );
}
