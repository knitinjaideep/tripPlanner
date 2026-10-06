"use client";

import { useState, useTransition } from "react";
import { ArrowLeft, Info, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { applyPackingStarter, copyPackingFromTrip, deletePackingCategory } from "@/app/actions/packing";
import { secondaryButtonClass } from "@/components/forms/fields";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDateRange } from "@/lib/dates";
import { STARTER_CATEGORIES, planMerge, starterSource, type MergeTargetCategory, type StarterKey } from "@/lib/packing";
import type { PackingCategoryWithItems, PackingSource } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PackingCategoryIcon } from "./category-icon";

const primaryButton =
  "focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-moss-ink px-5 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-moss-hover disabled:cursor-not-allowed disabled:opacity-60";

const checkbox = "mt-0.5 size-5 shrink-0 accent-moss-ink";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Shell({
  open,
  onOpenChange,
  pending,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending?: boolean;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-hidden rounded-2xl bg-background p-0 sm:max-w-lg">
        <DialogHeader className="px-5 pt-5 pb-3 pr-16 sm:px-6">
          <DialogTitle className="font-display text-2xl font-semibold text-ink">{title}</DialogTitle>
          <DialogDescription className="text-[0.9375rem] text-muted-foreground">{description}</DialogDescription>
        </DialogHeader>
        {open ? children : null}
      </DialogContent>
    </Dialog>
  );
}

function Footer({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col-reverse gap-3 border-t border-border px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
      {children}
    </div>
  );
}

function MergeNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex gap-2.5 rounded-xl bg-moss-soft/70 p-3.5 text-sm text-ink">
      <Info className="mt-0.5 size-4 shrink-0 text-moss-ink" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

const asTargets = (categories: PackingCategoryWithItems[]): MergeTargetCategory[] =>
  categories.map((c) => ({ id: c.id, name: c.name, items: c.items }));

/* ------------------------------------------------------------------ */
/* Starter checklist                                                   */
/* ------------------------------------------------------------------ */

export function StarterDialog({
  tripId,
  open,
  onOpenChange,
  current,
}: {
  tripId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: PackingCategoryWithItems[];
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      pending={pending}
      title="Starter checklist"
      description="A general family-trip list. Pick the categories you want — you can edit or remove anything afterwards."
    >
      <StarterBody
        current={current}
        pending={pending}
        onCancel={() => onOpenChange(false)}
        onApply={(keys) =>
          startTransition(async () => {
            const result = await applyPackingStarter(tripId, keys);
            if (result.ok) {
              toast.success(result.message);
              onOpenChange(false);
            } else {
              toast.error(result.message ?? "Couldn’t add the starter items.");
            }
          })
        }
      />
    </Shell>
  );
}

function StarterBody({
  current,
  pending,
  onCancel,
  onApply,
}: {
  current: PackingCategoryWithItems[];
  pending: boolean;
  onCancel: () => void;
  onApply: (keys: StarterKey[]) => void;
}) {
  const [selected, setSelected] = useState<Set<StarterKey>>(() => new Set(STARTER_CATEGORIES.map((c) => c.key)));
  const targets = asTargets(current);
  const plan = planMerge(starterSource([...selected]), targets);
  const hasItems = current.some((c) => c.items.length > 0);

  const toggle = (key: StarterKey, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  return (
    <>
      <div className="max-h-[60dvh] space-y-4 overflow-y-auto px-5 pb-5 sm:px-6">
        {hasItems ? (
          <MergeNote>
            Only items that aren’t on your list yet are added. Categories with the same name are combined; nothing you
            already have is changed.
          </MergeNote>
        ) : null}
        <fieldset>
          <legend className="sr-only">Categories to add</legend>
          <ul className="divide-y divide-border rounded-xl border border-border bg-white">
            {STARTER_CATEGORIES.map((c) => {
              const one = planMerge(starterSource([c.key]), targets);
              const status =
                one.addedItems === 0
                  ? "Already on your list"
                  : one.skippedItems > 0
                    ? `${one.addedItems} new · ${one.skippedItems} already on your list`
                    : plural(one.addedItems, "item");
              return (
                <li key={c.key}>
                  <label className="flex cursor-pointer items-start gap-3 p-3.5 hover:bg-secondary/50">
                    <input
                      type="checkbox"
                      className={checkbox}
                      checked={selected.has(c.key)}
                      onChange={(e) => toggle(c.key, e.target.checked)}
                    />
                    <PackingCategoryIcon name={c.name} className="size-7" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <span className="font-semibold text-ink">{c.name}</span>
                        <span className={cn("text-xs", one.addedItems === 0 ? "text-muted-foreground" : "text-moss-ink")}>
                          {status}
                        </span>
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">{c.items.join(", ")}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      </div>
      <Footer>
        <button type="button" onClick={onCancel} className={secondaryButtonClass} disabled={pending}>
          Cancel
        </button>
        <button
          type="button"
          className={primaryButton}
          disabled={pending || plan.addedItems === 0}
          aria-busy={pending}
          onClick={() => onApply([...selected])}
        >
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {pending
            ? "Adding…"
            : selected.size === 0
              ? "Choose a category"
              : plan.addedItems === 0
                ? "Nothing new to add"
                : `Add ${plural(plan.addedItems, "item")}`}
        </button>
      </Footer>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Copy from another trip                                              */
/* ------------------------------------------------------------------ */

export function CopyDialog({
  tripId,
  open,
  onOpenChange,
  current,
  sources,
}: {
  tripId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: PackingCategoryWithItems[];
  sources: PackingSource[];
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      pending={pending}
      title="Copy from another trip"
      description="Reuse a list you’ve made before. The other trip’s list stays exactly as it is."
    >
      <CopyBody
        current={current}
        sources={sources}
        pending={pending}
        onCancel={() => onOpenChange(false)}
        onCopy={(sourceId, categories) =>
          startTransition(async () => {
            const result = await copyPackingFromTrip(tripId, { source_trip_id: sourceId, categories });
            if (result.ok) {
              toast.success(result.message);
              onOpenChange(false);
            } else {
              toast.error(result.message ?? "Couldn’t copy that list.");
            }
          })
        }
      />
    </Shell>
  );
}

function CopyBody({
  current,
  sources,
  pending,
  onCancel,
  onCopy,
}: {
  current: PackingCategoryWithItems[];
  sources: PackingSource[];
  pending: boolean;
  onCancel: () => void;
  onCopy: (sourceId: string, categories: string[] | "all") => void;
}) {
  const withItems = sources.filter((s) => s.categories.some((c) => c.items.length > 0));
  const [step, setStep] = useState<"trip" | "categories" | "confirm">("trip");
  const [sourceId, setSourceId] = useState<string | null>(withItems.length === 1 ? withItems[0].id : null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const source = sources.find((s) => s.id === sourceId);
  const copyable = source?.categories.filter((c) => c.items.length > 0) ?? [];
  const chosen = copyable.filter((c) => selected.has(c.id));
  const hasItems = current.some((c) => c.items.length > 0);
  const plan = planMerge(
    chosen.map((c) => ({
      name: c.name,
      items: c.items.map((i) => ({ ...i, quantity: 1, notes: null })),
    })),
    asTargets(current),
  );
  const totalItems = (s: PackingSource) => s.categories.reduce((n, c) => n + c.items.length, 0);

  if (sources.length === 0 || withItems.length === 0) {
    return (
      <>
        <p className="px-5 pb-6 text-[0.9375rem] text-muted-foreground sm:px-6">
          {sources.length === 0
            ? "You don’t have any other trips yet. Once another trip has a packing list, you can copy it here."
            : "None of your other trips has a packing list yet."}
        </p>
        <Footer>
          <button type="button" onClick={onCancel} className={secondaryButtonClass}>
            Close
          </button>
        </Footer>
      </>
    );
  }

  const back = (to: "trip" | "categories") => (
    <button type="button" onClick={() => setStep(to)} className={secondaryButtonClass} disabled={pending}>
      <ArrowLeft className="size-4" aria-hidden="true" /> Back
    </button>
  );

  if (step === "trip") {
    return (
      <>
        <fieldset className="max-h-[60dvh] overflow-y-auto px-5 pb-5 sm:px-6">
          <legend className="mb-2 text-sm font-semibold text-ink">1. Choose a trip</legend>
          <ul className="divide-y divide-border rounded-xl border border-border bg-white">
            {sources.map((s) => {
              const items = totalItems(s);
              const cats = s.categories.filter((c) => c.items.length > 0).length;
              return (
                <li key={s.id}>
                  <label
                    className={cn(
                      "flex items-start gap-3 p-3.5",
                      items ? "cursor-pointer hover:bg-secondary/50" : "cursor-not-allowed opacity-60",
                    )}
                  >
                    <input
                      type="radio"
                      name="source-trip"
                      className={checkbox}
                      disabled={items === 0}
                      checked={sourceId === s.id}
                      onChange={() => setSourceId(s.id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-ink">{s.title}</span>
                      <span className="block text-sm text-muted-foreground">
                        {s.destination} · {formatDateRange(s.start_date, s.end_date, "short")}
                      </span>
                      <span className="mt-0.5 block text-sm text-ink">
                        {items ? `${plural(cats, "category", "categories")} · ${plural(items, "item")}` : "No packing list"}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
        <Footer>
          <button type="button" onClick={onCancel} className={secondaryButtonClass}>
            Cancel
          </button>
          <button
            type="button"
            className={primaryButton}
            disabled={!source}
            onClick={() => {
              setSelected(new Set(copyable.map((c) => c.id)));
              setStep("categories");
            }}
          >
            Next
          </button>
        </Footer>
      </>
    );
  }

  if (step === "categories") {
    const all = chosen.length === copyable.length;
    return (
      <>
        <div className="max-h-[60dvh] space-y-4 overflow-y-auto px-5 pb-5 sm:px-6">
          <fieldset>
            <div className="mb-2 flex items-center justify-between gap-3">
              <legend className="text-sm font-semibold text-ink">2. Choose categories from {source!.title}</legend>
              <button
                type="button"
                className="focus-ring min-h-11 rounded-lg px-2 text-sm font-semibold text-moss-ink hover:bg-moss-soft/60"
                onClick={() => setSelected(all ? new Set() : new Set(copyable.map((c) => c.id)))}
              >
                {all ? "Select none" : "Select all"}
              </button>
            </div>
            <ul className="divide-y divide-border rounded-xl border border-border bg-white">
              {copyable.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-center gap-3 p-3.5 hover:bg-secondary/50">
                    <input
                      type="checkbox"
                      className={cn(checkbox, "mt-0")}
                      checked={selected.has(c.id)}
                      onChange={(e) =>
                        setSelected((s) => {
                          const next = new Set(s);
                          if (e.target.checked) next.add(c.id);
                          else next.delete(c.id);
                          return next;
                        })
                      }
                    />
                    <PackingCategoryIcon name={c.name} className="size-7" />
                    <span className="min-w-0 flex-1 truncate font-semibold text-ink">{c.name}</span>
                    <span className="text-sm text-muted-foreground">{plural(c.items.length, "item")}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          {hasItems ? (
            <MergeNote>
              This trip already has a list, so only missing items are added. A category with the same name is
              combined with yours, and an item already in it (same name and traveler) is skipped. Nothing here is
              replaced or removed.
            </MergeNote>
          ) : null}
        </div>
        <Footer>
          {back("trip")}
          <button type="button" className={primaryButton} disabled={chosen.length === 0} onClick={() => setStep("confirm")}>
            Review
          </button>
        </Footer>
      </>
    );
  }

  return (
    <>
      <div className="space-y-4 px-5 pb-5 sm:px-6">
        <p className="text-sm font-semibold text-ink">3. Confirm</p>
        {plan.addedItems === 0 ? (
          <p className="rounded-xl border border-border bg-white p-4 text-[0.9375rem] text-ink">
            Everything you chose is already on this list. Nothing would be added.
          </p>
        ) : (
          <ul className="space-y-1.5 rounded-xl border border-border bg-white p-4 text-[0.9375rem] text-ink">
            <li>
              <strong>{plural(plan.addedItems, "item")}</strong> will be added
              {plan.newCategories ? ` (${plural(plan.newCategories, "new category", "new categories")})` : ""}.
            </li>
            {plan.skippedItems ? <li>{plural(plan.skippedItems, "item")} already on this list will be skipped.</li> : null}
            <li className="text-muted-foreground">Copied items start unpacked. Names, quantities, notes and who they’re for are copied.</li>
            <li className="text-muted-foreground">Changes after copying only affect this trip.</li>
          </ul>
        )}
      </div>
      <Footer>
        {back("categories")}
        <button
          type="button"
          className={primaryButton}
          disabled={pending || plan.addedItems === 0}
          aria-busy={pending}
          onClick={() => onCopy(source!.id, chosen.length === copyable.length ? "all" : chosen.map((c) => c.id))}
        >
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {pending ? "Copying…" : plan.addedItems === 0 ? "Nothing to copy" : `Copy ${plural(plan.addedItems, "item")}`}
        </button>
      </Footer>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Delete a category                                                   */
/* ------------------------------------------------------------------ */

export function DeleteCategoryDialog({
  tripId,
  category,
  others,
  onClose,
}: {
  tripId: string;
  category: { id: string; name: string; items: number } | null;
  others: { id: string; name: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Shell
      open={category !== null}
      onOpenChange={(open) => !open && onClose()}
      pending={pending}
      title={category && category.items > 0 ? `Delete “${category.name}”?` : "Remove this category?"}
      description={
        category && category.items > 0
          ? `It has ${plural(category.items, "item")}. Choose what happens to them.`
          : `“${category?.name ?? ""}” is empty, so nothing else is affected.`
      }
    >
      {category ? (
        <DeleteCategoryBody
          key={`${category.id}-${category.items}`}
          category={category}
          others={others}
          pending={pending}
          onCancel={onClose}
          onConfirm={(choice) =>
            startTransition(async () => {
              const result = await deletePackingCategory(tripId, category.id, choice);
              if (result.ok) {
                toast.success(result.message);
                onClose();
              } else {
                toast.error(result.message ?? "Couldn’t remove that category.");
                // Items appeared since the dialog opened: reload so it offers move / delete.
                if (result.items) router.refresh();
              }
            })
          }
        />
      ) : null}
    </Shell>
  );
}

function DeleteCategoryBody({
  category,
  others,
  pending,
  onCancel,
  onConfirm,
}: {
  category: { id: string; name: string; items: number };
  others: { id: string; name: string }[];
  pending: boolean;
  onCancel: () => void;
  onConfirm: (choice: { items: "none" } | { items: "delete" } | { items: "move"; target_category_id: string }) => void;
}) {
  const [mode, setMode] = useState<"move" | "delete" | null>(others.length ? "move" : null);
  const [target, setTarget] = useState(others[0]?.id ?? "");
  const n = category.items;

  if (n === 0) {
    return (
      <Footer>
        <button type="button" onClick={onCancel} className={secondaryButtonClass} disabled={pending}>
          Keep it
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => onConfirm({ items: "none" })}
          className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-destructive px-5 text-[0.9375rem] font-semibold text-white hover:bg-[#9a1d14] disabled:opacity-70"
        >
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {pending ? "Removing…" : "Remove category"}
        </button>
      </Footer>
    );
  }

  return (
    <>
      <fieldset className="space-y-3 px-5 pb-5 sm:px-6">
        <legend className="sr-only">What happens to its items</legend>
        <label
          className={cn(
            "flex items-start gap-3 rounded-xl border p-3.5",
            others.length ? "cursor-pointer" : "cursor-not-allowed opacity-60",
            mode === "move" ? "border-moss bg-moss-soft/40" : "border-border bg-white",
          )}
        >
          <input
            type="radio"
            name="delete-mode"
            className={checkbox}
            checked={mode === "move"}
            disabled={!others.length}
            onChange={() => setMode("move")}
          />
          <span className="min-w-0 flex-1 space-y-2">
            <span className="block font-semibold text-ink">Move the {plural(n, "item")} to another category</span>
            {others.length ? (
              <select
                aria-label="Move items to"
                value={target}
                onChange={(e) => {
                  setTarget(e.target.value);
                  setMode("move");
                }}
                className="h-11 w-full rounded-[10px] border border-input bg-white px-3 text-[0.9375rem] text-ink focus-visible:border-moss focus-visible:ring-3 focus-visible:ring-moss/25 focus-visible:outline-none"
              >
                {others.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="block text-sm text-muted-foreground">Add another category first to move items into it.</span>
            )}
          </span>
        </label>
        <label
          className={cn(
            "flex cursor-pointer items-start gap-3 rounded-xl border p-3.5",
            mode === "delete" ? "border-destructive bg-[#fff1ee]" : "border-border bg-white",
          )}
        >
          <input type="radio" name="delete-mode" className={checkbox} checked={mode === "delete"} onChange={() => setMode("delete")} />
          <span>
            <span className="block font-semibold text-ink">Delete the category and its {plural(n, "item")}</span>
            <span className="block text-sm text-muted-foreground">This can’t be undone.</span>
          </span>
        </label>
      </fieldset>
      <Footer>
        <button type="button" onClick={onCancel} className={secondaryButtonClass} disabled={pending}>
          Keep it
        </button>
        {mode === "delete" ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => onConfirm({ items: "delete" })}
            className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-destructive px-5 text-[0.9375rem] font-semibold text-white hover:bg-[#9a1d14] disabled:opacity-70"
          >
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            {pending ? "Deleting…" : `Delete category and ${plural(n, "item")}`}
          </button>
        ) : (
          <button
            type="button"
            className={primaryButton}
            disabled={pending || mode !== "move" || !target}
            onClick={() => onConfirm({ items: "move", target_category_id: target })}
          >
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            {pending ? "Moving…" : "Move items and remove category"}
          </button>
        )}
      </Footer>
    </>
  );
}
