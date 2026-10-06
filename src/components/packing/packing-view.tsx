"use client";

import { useOptimistic, useRef, useState, useTransition, type FormEvent } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  CopyPlus,
  FolderInput,
  ListChecks,
  Loader2,
  Luggage,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { MascotImage } from "@/components/mascot";
import { toast } from "sonner";
import {
  deletePackingItem,
  movePackingItem,
  reorderPackingCategories,
  reorderPackingItems,
  savePackingItem,
  unpackAllPackingItems,
} from "@/app/actions/packing";
import { controlClass } from "@/components/forms/fields";
import { ConfirmDialog } from "@/components/trip/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  UNASSIGNED,
  matchesFilters,
  moveInOrder,
  progressOf,
  travelerSuggestions,
  type PackedFilter,
  type Progress,
} from "@/lib/packing";
import type { ActionState, PackingCategoryWithItems, PackingItem, PackingSource } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PackingCategoryIcon } from "./category-icon";
import { CopyDialog, DeleteCategoryDialog, StarterDialog } from "./packing-dialogs";
import { PackingCategoryForm, PackingItemForm } from "./packing-forms";
import { usePackedToggles } from "./use-packed-toggles";

const addButton =
  "focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-moss-ink px-5 text-[0.9375rem] font-semibold text-white shadow-[0_6px_16px_-8px_rgba(62,122,58,0.55)] transition-colors hover:bg-moss-hover";
const ghostButton =
  "focus-ring inline-flex min-h-11 items-center gap-2 rounded-xl border border-input bg-white px-4 text-[0.9375rem] font-semibold text-ink transition-colors hover:bg-secondary";
const iconButton =
  "focus-ring grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-ink";
const menuItem = "min-h-11 rounded-lg";

type Patch =
  | { type: "orderItems"; categoryId: string; ids: string[] }
  | { type: "orderCategories"; ids: string[] }
  | { type: "move"; itemId: string; to: string }
  | { type: "remove"; itemId: string };

/** Optimistic structure changes; they fall back to the server's list when the request ends. */
function applyPatch(categories: PackingCategoryWithItems[], patch: Patch): PackingCategoryWithItems[] {
  const byId = <T extends { id: string }>(rows: T[], ids: string[]) =>
    ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is T => Boolean(r));
  switch (patch.type) {
    case "orderCategories":
      return byId(categories, patch.ids);
    case "orderItems":
      return categories.map((c) => (c.id === patch.categoryId ? { ...c, items: byId(c.items, patch.ids) } : c));
    case "move": {
      const item = categories.flatMap((c) => c.items).find((i) => i.id === patch.itemId);
      if (!item) return categories;
      return categories.map((c) => ({
        ...c,
        items:
          c.id === patch.to
            ? [...c.items.filter((i) => i.id !== item.id), { ...item, category_id: c.id }]
            : c.items.filter((i) => i.id !== item.id),
      }));
    }
    case "remove":
      return categories.map((c) => ({ ...c, items: c.items.filter((i) => i.id !== patch.itemId) }));
  }
}

export function PackingView({
  tripId,
  tripTravelers,
  categories: saved,
  sources,
}: {
  tripId: string;
  tripTravelers: string[];
  categories: PackingCategoryWithItems[];
  sources: PackingSource[];
}) {
  const [structure, patch] = useOptimistic(saved, applyPatch);
  const [, startTransition] = useTransition();
  const { shown, setPacked } = usePackedToggles(tripId, saved);

  // What's on screen: optimistic structure + optimistic checkmarks.
  const categories = structure.map((c) => ({
    ...c,
    items: c.items.map((i) => (shown[i.id] ? { ...i, is_packed: shown[i.id].packed } : i)),
  }));
  const allItems = categories.flatMap((c) => c.items);
  const overall = progressOf(allItems);
  const travelers = travelerSuggestions(tripTravelers, allItems.map((i) => i.traveler_name));
  const hasUnassigned = allItems.some((i) => !i.traveler_name);

  const [show, setShow] = useState<PackedFilter>("all");
  const [traveler, setTraveler] = useState("");
  const [selected, setSelected] = useState<string>("all");
  const scope = selected === "all" ? categories : categories.filter((c) => c.id === selected);
  const scopeAll = scope.length === 0 ? categories : scope;
  const filtered = show !== "all" || traveler !== "";
  const canReorder = !filtered;

  const [itemSheet, setItemSheet] = useState<{ open: boolean; item?: PackingItem; categoryId?: string }>({ open: false });
  const [categoryDialog, setCategoryDialog] = useState<{
    open: boolean;
    category?: { id: string; name: string };
    first?: boolean;
  }>({ open: false });
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [starterOpen, setStarterOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const deleting = categories.find((c) => c.id === deletingId);
  const copyAvailable = sources.some((s) => s.categories.some((c) => c.items.length > 0));

  const run = (p: Patch, action: () => Promise<ActionState>, done?: string) =>
    startTransition(async () => {
      patch(p);
      const result = await action();
      if (!result.ok) toast.error(result.message ?? "Couldn’t save that change.");
      else if (done) setAnnouncement(done);
    });

  const moveItem = (category: PackingCategoryWithItems, item: PackingItem, direction: -1 | 1) => {
    const ids = moveInOrder(
      category.items.map((i) => i.id),
      item.id,
      direction,
    );
    if (!ids) return;
    run(
      { type: "orderItems", categoryId: category.id, ids },
      () => reorderPackingItems(tripId, category.id, ids),
      `${item.label} moved ${direction === -1 ? "up" : "down"}.`,
    );
  };

  const moveCategory = (category: PackingCategoryWithItems, direction: -1 | 1) => {
    const ids = moveInOrder(
      categories.map((c) => c.id),
      category.id,
      direction,
    );
    if (!ids) return;
    run(
      { type: "orderCategories", ids },
      () => reorderPackingCategories(tripId, ids),
      `${category.name} moved ${direction === -1 ? "up" : "down"}.`,
    );
  };

  const actions = {
    tripId,
    canReorder,
    categories,
    setPacked,
    saving: (id: string) => shown[id]?.saving ?? false,
    edit: (item: PackingItem) => setItemSheet({ open: true, item }),
    addTo: (categoryId: string) => setItemSheet({ open: true, categoryId }),
    moveItem,
    moveTo: (item: PackingItem, to: { id: string; name: string }) =>
      startTransition(async () => {
        patch({ type: "move", itemId: item.id, to: to.id });
        const result = await movePackingItem(tripId, item.id, to.id);
        if (result.ok) toast.success(`Moved “${item.label}” to ${to.name}.`);
        else toast.error(result.message ?? "Couldn’t move that item.");
      }),
    remove: (item: PackingItem) =>
      startTransition(async () => {
        patch({ type: "remove", itemId: item.id });
        const result = await deletePackingItem(tripId, item.id);
        if (result.ok) toast.success(`Removed “${item.label}”.`);
        else toast.error(result.message ?? "Couldn’t remove that item.");
      }),
    moveCategory,
    renameCategory: (c: PackingCategoryWithItems) => setCategoryDialog({ open: true, category: c }),
    deleteCategory: (c: PackingCategoryWithItems) => setDeletingId(c.id),
  };

  const counts = (filter: PackedFilter) =>
    scopeAll.flatMap((c) => c.items).filter((i) => matchesFilters(i, filter, traveler)).length;

  const moreMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn(ghostButton, "px-3")} aria-label="More packing actions">
        <MoreHorizontal className="size-4" aria-hidden="true" />
        <span className="hidden sm:inline">More</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 rounded-xl p-1.5">
        <DropdownMenuItem className={menuItem} onSelect={() => setCategoryDialog({ open: true })}>
          <Plus aria-hidden="true" /> Add category
        </DropdownMenuItem>
        <DropdownMenuItem className={menuItem} onSelect={() => setStarterOpen(true)}>
          <ListChecks aria-hidden="true" /> Add from starter checklist…
        </DropdownMenuItem>
        <DropdownMenuItem className={menuItem} onSelect={() => setCopyOpen(true)}>
          <CopyPlus aria-hidden="true" /> Copy from another trip…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className={menuItem} disabled={overall.packed === 0} onSelect={() => setResetOpen(true)}>
          <RotateCcw aria-hidden="true" /> Mark everything unpacked…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const visibleSections = scopeAll
    .map((c) => ({ category: c, items: c.items.filter((i) => matchesFilters(i, show, traveler)) }))
    .filter((s) => !filtered || selected !== "all" || s.items.length > 0);

  return (
    <div className={cn("space-y-6", categories.length > 0 && "pb-20 lg:pb-0")}>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      <div className="flex items-start justify-between gap-4 lg:items-end">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-3xl font-semibold text-ink">Packing</h2>
          {overall.total > 0 ? (
            <ProgressLine progress={overall} />
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              {categories.length ? "Add items to your categories to start checking them off." : "One checklist for the whole family."}
            </p>
          )}
        </div>
        {categories.length > 0 ? (
          <div className="flex shrink-0 gap-2">
            <button type="button" className={cn(addButton, "hidden lg:inline-flex")} onClick={() => setItemSheet({ open: true })}>
              <Plus className="size-4" aria-hidden="true" /> Add item
            </button>
            {moreMenu}
          </div>
        ) : null}
      </div>

      {categories.length === 0 ? (
        <EmptyState
          copyAvailable={copyAvailable}
          hasOtherTrips={sources.length > 0}
          onEmpty={() => setCategoryDialog({ open: true, first: true })}
          onStarter={() => setStarterOpen(true)}
          onCopy={() => setCopyOpen(true)}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[13.5rem_minmax(0,1fr)] xl:grid-cols-[13.5rem_minmax(0,1fr)_15rem]">
          {/* Desktop category navigation */}
          <nav aria-label="Packing categories" className="hidden lg:block">
            <ul className="sticky top-4 space-y-1">
              <CategoryNavItem
                label="All categories"
                progress={overall}
                active={selected === "all"}
                onSelect={() => setSelected("all")}
              />
              {categories.map((c) => (
                <CategoryNavItem
                  key={c.id}
                  label={c.name}
                  icon={<PackingCategoryIcon name={c.name} className="size-7" />}
                  progress={progressOf(c.items)}
                  active={selected === c.id}
                  onSelect={() => setSelected(c.id)}
                />
              ))}
              <li className="pt-2">
                <button
                  type="button"
                  onClick={() => setCategoryDialog({ open: true })}
                  className="focus-ring flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-sm font-semibold text-moss-ink hover:bg-moss-soft/60"
                >
                  <Plus className="size-4" aria-hidden="true" /> Add category
                </button>
              </li>
            </ul>
          </nav>

          <div className="min-w-0 space-y-5">
            {/* Filters */}
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <label className="relative lg:hidden">
                <span className="sr-only">Category</span>
                <select
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                  className={cn(controlClass, "w-full appearance-none border pr-9 font-medium sm:w-auto")}
                >
                  <option value="all">
                    All categories ({overall.packed}/{overall.total})
                  </option>
                  {categories.map((c) => {
                    const p = progressOf(c.items);
                    return (
                      <option key={c.id} value={c.id}>
                        {c.name} ({p.packed}/{p.total})
                      </option>
                    );
                  })}
                </select>
                <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              </label>
              <div role="radiogroup" aria-label="Show" className="flex gap-1 rounded-xl bg-secondary p-1">
                {(
                  [
                    ["all", "All"],
                    ["remaining", "To pack"],
                    ["packed", "Packed"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={show === value}
                    onClick={() => setShow(value)}
                    className={cn(
                      "focus-ring flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition-colors sm:flex-none",
                      show === value ? "bg-white text-ink shadow-sm" : "text-muted-foreground hover:text-ink",
                    )}
                  >
                    {label}
                    <span className="text-xs font-medium text-muted-foreground">{counts(value)}</span>
                  </button>
                ))}
              </div>
              {travelers.length > 0 ? (
                <label className="relative">
                  <span className="sr-only">Traveler</span>
                  <select
                    value={traveler}
                    onChange={(e) => setTraveler(e.target.value)}
                    className={cn(
                      controlClass,
                      "w-full appearance-none border pr-9 font-medium sm:w-auto",
                      traveler && "border-moss bg-moss-soft/50 text-moss-ink",
                    )}
                  >
                    <option value="">Everyone</option>
                    {travelers.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                    {hasUnassigned ? <option value={UNASSIGNED}>Not assigned</option> : null}
                  </select>
                  <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                </label>
              ) : null}
            </div>

            {visibleSections.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-input px-6 py-10 text-center">
                <p className="font-semibold text-ink">
                  {show === "remaining" && overall.total > 0 && overall.remaining === 0 ? "Everything is packed." : "Nothing matches these filters."}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setShow("all");
                    setTraveler("");
                  }}
                  className="focus-ring mt-3 inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold text-moss-ink hover:bg-moss-soft/60"
                >
                  Show all items
                </button>
              </div>
            ) : (
              visibleSections.map(({ category, items }) => (
                <CategorySection
                  key={category.id}
                  category={category}
                  items={items}
                  index={categories.indexOf(category)}
                  count={categories.length}
                  filtered={filtered}
                  actions={actions}
                />
              ))
            )}
            {!canReorder ? (
              <p className="text-xs text-muted-foreground">Reordering is available when all items are shown.</p>
            ) : null}
          </div>

          <StillToPack categories={categories} travelers={travelers} onShowRemaining={(id) => {
            setSelected(id ?? "all");
            setShow("remaining");
            setTraveler("");
          }} />
        </div>
      )}

      {/* Phone: always-reachable add button */}
      {categories.length > 0 ? (
        <div className="fixed inset-x-4 bottom-4 z-30 lg:hidden">
          <button
            type="button"
            className={cn(addButton, "min-h-12 w-full")}
            onClick={() => setItemSheet({ open: true, categoryId: selected === "all" ? undefined : selected })}
          >
            <Plus className="size-4" aria-hidden="true" /> Add item
          </button>
        </div>
      ) : null}

      <Sheet open={itemSheet.open} onOpenChange={(open) => !open && setItemSheet({ open: false })}>
        <SheetContent side="right" className="w-full gap-0 bg-background p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
          <SheetHeader className="gap-1 px-5 pt-5 pb-4 pr-16 sm:px-6">
            <SheetTitle className="font-display text-2xl leading-tight font-semibold text-ink">
              {itemSheet.item ? "Edit item" : "Add an item"}
            </SheetTitle>
            <SheetDescription className="text-sm text-muted-foreground">
              {itemSheet.item ? itemSheet.item.label : "Only a name is needed."}
            </SheetDescription>
          </SheetHeader>
          {itemSheet.open ? (
            <PackingItemForm
              key={itemSheet.item?.id ?? `new-${itemSheet.categoryId ?? ""}`}
              tripId={tripId}
              item={itemSheet.item}
              categories={categories}
              defaultCategoryId={itemSheet.categoryId ?? (selected === "all" ? undefined : selected)}
              travelers={travelers}
              onCancel={() => setItemSheet({ open: false })}
              onSaved={() => setItemSheet({ open: false })}
            />
          ) : null}
        </SheetContent>
      </Sheet>

      <Dialog open={categoryDialog.open} onOpenChange={(open) => !open && setCategoryDialog({ open: false })}>
        <DialogContent className="rounded-2xl bg-background p-6 sm:max-w-md">
          <DialogHeader className="pr-10">
            <DialogTitle className="font-display text-2xl font-semibold text-ink">
              {categoryDialog.category ? "Rename category" : categoryDialog.first ? "Name your first category" : "Add a category"}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {categoryDialog.first ? "You can add more categories any time." : "Groups like Clothes, Toiletries or Kids’ things."}
            </DialogDescription>
          </DialogHeader>
          {categoryDialog.open ? (
            <PackingCategoryForm
              tripId={tripId}
              category={categoryDialog.category}
              defaultName={categoryDialog.first ? "Essentials" : undefined}
              onCancel={() => setCategoryDialog({ open: false })}
              onSaved={() => setCategoryDialog({ open: false })}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <DeleteCategoryDialog
        tripId={tripId}
        category={deleting ? { id: deleting.id, name: deleting.name, items: deleting.items.length } : null}
        others={categories.filter((c) => c.id !== deletingId).map((c) => ({ id: c.id, name: c.name }))}
        onClose={() => {
          if (deletingId === selected) setSelected("all");
          setDeletingId(null);
        }}
      />
      <StarterDialog tripId={tripId} open={starterOpen} onOpenChange={setStarterOpen} current={categories} />
      <CopyDialog tripId={tripId} open={copyOpen} onOpenChange={setCopyOpen} current={categories} sources={sources} />
      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title="Mark everything unpacked?"
        description={`All ${overall.packed} packed ${overall.packed === 1 ? "item" : "items"} on this trip’s list — in every category — will be unchecked. No items are deleted.`}
        confirmLabel="Mark all unpacked"
        pendingLabel="Unpacking…"
        cancelLabel="Cancel"
        onConfirm={async () => {
          const result = await unpackAllPackingItems(tripId);
          if (result.ok) {
            toast.success(result.message);
            setResetOpen(false);
          } else {
            toast.error(result.message ?? "Couldn’t reset the list.");
          }
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ProgressBar({ percent, className }: { percent: number; className?: string }) {
  return (
    <span className={cn("block h-2 overflow-hidden rounded-full bg-secondary", className)} aria-hidden="true">
      <span
        className={cn("block h-full rounded-full transition-[width] duration-300", percent === 100 ? "bg-moss" : "bg-moss-ink")}
        style={{ width: `${percent}%` }}
      />
    </span>
  );
}

function ProgressLine({ progress: p }: { progress: Progress }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <ProgressBar percent={p.percent} className="w-36 sm:w-48" />
      <p className="text-sm text-ink">
        <span className="font-semibold">
          {p.packed} of {p.total} packed
        </span>
        <span className="text-muted-foreground"> · {p.percent}%{p.remaining ? ` · ${p.remaining} to go` : " · all done"}</span>
      </p>
    </div>
  );
}

function CategoryNavItem({
  label,
  icon,
  progress: p,
  active,
  onSelect,
}: {
  label: string;
  icon?: React.ReactNode;
  progress: Progress;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? "true" : undefined}
        className={cn(
          "focus-ring flex min-h-11 w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-sm transition-colors",
          active ? "bg-white font-semibold text-ink shadow-sm ring-1 ring-border" : "text-ink hover:bg-secondary",
        )}
      >
        {icon ?? (
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-secondary text-ink">
            <Luggage className="size-4" aria-hidden="true" />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className={cn("text-xs tabular-nums", p.total > 0 && p.remaining === 0 ? "text-moss-ink" : "text-muted-foreground")}>
          {p.packed}/{p.total}
          <span className="sr-only"> packed</span>
        </span>
      </button>
    </li>
  );
}

type Actions = {
  tripId: string;
  canReorder: boolean;
  categories: PackingCategoryWithItems[];
  setPacked: (id: string, packed: boolean) => void;
  saving: (id: string) => boolean;
  edit: (item: PackingItem) => void;
  addTo: (categoryId: string) => void;
  moveItem: (category: PackingCategoryWithItems, item: PackingItem, direction: -1 | 1) => void;
  moveTo: (item: PackingItem, to: { id: string; name: string }) => void;
  remove: (item: PackingItem) => void;
  moveCategory: (category: PackingCategoryWithItems, direction: -1 | 1) => void;
  renameCategory: (category: PackingCategoryWithItems) => void;
  deleteCategory: (category: PackingCategoryWithItems) => void;
};

function CategorySection({
  category,
  items,
  index,
  count,
  filtered,
  actions,
}: {
  category: PackingCategoryWithItems;
  items: PackingItem[];
  index: number;
  count: number;
  filtered: boolean;
  actions: Actions;
}) {
  const p = progressOf(category.items);
  const headingId = `packing-cat-${category.id}`;
  return (
    <section aria-labelledby={headingId} className="card-surface p-3 sm:p-4">
      <div className="flex items-center gap-3 px-1 pb-2">
        <PackingCategoryIcon name={category.name} />
        <h3 id={headingId} className="min-w-0 flex-1 truncate text-lg font-semibold text-ink">
          {category.name}
        </h3>
        <span className={cn("text-sm tabular-nums", p.total > 0 && p.remaining === 0 ? "font-semibold text-moss-ink" : "text-muted-foreground")}>
          {p.packed}/{p.total}
          <span className="sr-only"> packed</span>
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger className={iconButton} aria-label={`Options for ${category.name}`}>
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 rounded-xl p-1.5">
            <DropdownMenuItem className={menuItem} onSelect={() => actions.addTo(category.id)}>
              <Plus aria-hidden="true" /> Add item here
            </DropdownMenuItem>
            <DropdownMenuItem className={menuItem} onSelect={() => actions.renameCategory(category)}>
              <Pencil aria-hidden="true" /> Rename
            </DropdownMenuItem>
            <DropdownMenuItem className={menuItem} disabled={index <= 0} onSelect={() => actions.moveCategory(category, -1)}>
              <ArrowUp aria-hidden="true" /> Move category up
            </DropdownMenuItem>
            <DropdownMenuItem
              className={menuItem}
              disabled={index < 0 || index >= count - 1}
              onSelect={() => actions.moveCategory(category, 1)}
            >
              <ArrowDown aria-hidden="true" /> Move category down
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className={menuItem} variant="destructive" onSelect={() => actions.deleteCategory(category)}>
              <Trash2 aria-hidden="true" /> Delete category…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {items.length > 0 ? (
        <ul className="divide-y divide-border/70">
          {items.map((item) => (
            <ItemRow key={item.id} item={item} category={category} actions={actions} />
          ))}
        </ul>
      ) : (
        <p className="px-2 py-3 text-sm text-muted-foreground">
          {category.items.length === 0 ? "No items yet." : filtered ? "Nothing here matches these filters." : null}
        </p>
      )}
      <QuickAdd tripId={actions.tripId} category={category} />
    </section>
  );
}

function ItemRow({ item, category, actions }: { item: PackingItem; category: PackingCategoryWithItems; actions: Actions }) {
  const position = category.items.findIndex((i) => i.id === item.id);
  const saving = actions.saving(item.id);
  const others = actions.categories.filter((c) => c.id !== category.id);
  const notesId = item.notes ? `pi-notes-${item.id}` : undefined;

  return (
    <li className="flex items-start gap-1">
      <label className="flex min-h-12 min-w-0 flex-1 cursor-pointer items-start gap-3 rounded-xl px-2 py-2.5 hover:bg-secondary/50">
        <input
          type="checkbox"
          checked={item.is_packed}
          onChange={(e) => actions.setPacked(item.id, e.target.checked)}
          aria-describedby={notesId}
          className="mt-0.5 size-5 shrink-0 cursor-pointer accent-moss-ink"
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={cn("break-words", item.is_packed ? "text-muted-foreground line-through decoration-1" : "font-medium text-ink")}>
              {item.label}
            </span>
            {item.quantity > 1 ? (
              <span className="rounded-md bg-secondary px-1.5 py-0.5 text-xs font-semibold text-ink tabular-nums">
                <span aria-hidden="true">×{item.quantity}</span>
                <span className="sr-only">, quantity {item.quantity}</span>
              </span>
            ) : null}
            {item.traveler_name ? (
              <span className="rounded-full bg-surface-warm px-2 py-0.5 text-xs font-medium text-earth-ink">
                <span className="sr-only">, for </span>
                {item.traveler_name}
              </span>
            ) : null}
            {saving ? (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" aria-hidden="true" /> Saving…
              </span>
            ) : null}
          </span>
          {item.notes ? (
            <span id={notesId} className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">
              {item.notes}
            </span>
          ) : null}
        </span>
      </label>
      <DropdownMenu>
        <DropdownMenuTrigger className={cn(iconButton, "mt-0.5")} aria-label={`Options for ${item.label}`}>
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56 rounded-xl p-1.5">
          <DropdownMenuItem className={menuItem} onSelect={() => actions.edit(item)}>
            <Pencil aria-hidden="true" /> Edit…
          </DropdownMenuItem>
          {actions.canReorder ? (
            <>
              <DropdownMenuItem className={menuItem} disabled={position <= 0} onSelect={() => actions.moveItem(category, item, -1)}>
                <ArrowUp aria-hidden="true" /> Move up
              </DropdownMenuItem>
              <DropdownMenuItem
                className={menuItem}
                disabled={position < 0 || position >= category.items.length - 1}
                onSelect={() => actions.moveItem(category, item, 1)}
              >
                <ArrowDown aria-hidden="true" /> Move down
              </DropdownMenuItem>
            </>
          ) : null}
          {others.length > 0 ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className={menuItem}>
                <FolderInput aria-hidden="true" /> Move to…
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-80 w-52 overflow-y-auto rounded-xl p-1.5">
                {others.map((c) => (
                  <DropdownMenuItem key={c.id} className={menuItem} onSelect={() => actions.moveTo(item, c)}>
                    {c.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem className={menuItem} variant="destructive" onSelect={() => actions.remove(item)}>
            <Trash2 aria-hidden="true" /> Delete item
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

/** Type a name and press Enter; stays open for the next one. */
function QuickAdd({ tripId, category }: { tripId: string; category: PackingCategoryWithItems }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // A fresh id per item: a double Enter on the same text can't add it twice.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const input = useRef<HTMLInputElement>(null);
  const id = `quick-add-${category.id}`;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const label = value.trim();
    if (!label || pending) return;
    const data = new FormData();
    data.set("category_id", category.id);
    data.set("label", label);
    data.set("quantity", "1");
    data.set("request_id", requestId);
    startTransition(async () => {
      const result = await savePackingItem(tripId, null, { ok: false }, data);
      if (result.ok) {
        setValue("");
        setError(null);
        setRequestId(crypto.randomUUID());
        input.current?.focus();
      } else {
        setError(result.fieldErrors?.label?.[0] ?? result.message ?? "Couldn’t add that item.");
      }
    });
  };

  return (
    <form onSubmit={submit} className="mt-1 px-1">
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="sr-only">
          Add an item to {category.name}
        </label>
        <input
          ref={input}
          id={id}
          value={value}
          readOnly={pending}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          placeholder={`Add to ${category.name}…`}
          maxLength={120}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={cn(controlClass, "h-11 min-w-0 flex-1 border border-dashed bg-transparent focus-visible:border-solid focus-visible:bg-white")}
        />
        <button
          type="submit"
          disabled={pending || !value.trim()}
          aria-label={`Add to ${category.name}`}
          className="focus-ring grid size-11 shrink-0 place-items-center rounded-xl bg-moss-soft text-moss-ink transition-colors hover:bg-[#dce9c9] disabled:opacity-50"
        >
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
        </button>
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function StillToPack({
  categories,
  travelers,
  onShowRemaining,
}: {
  categories: PackingCategoryWithItems[];
  travelers: string[];
  onShowRemaining: (categoryId?: string) => void;
}) {
  const items = categories.flatMap((c) => c.items);
  const left = items.filter((i) => !i.is_packed);
  if (items.length === 0) return <div className="hidden xl:block" />;
  const byTraveler = travelers
    .map((t) => ({ name: t, n: left.filter((i) => matchesFilters(i, "remaining", t)).length }))
    .filter((t) => t.n > 0);
  const unassigned = left.filter((i) => !i.traveler_name).length;
  const byCategory = categories.map((c) => ({ c, n: c.items.filter((i) => !i.is_packed).length })).filter((x) => x.n > 0);

  return (
    <aside aria-label="Still to pack" className="hidden xl:block">
      <div className="sticky top-4 rounded-2xl bg-gold-soft p-5">
        <p className="eyebrow text-gold-ink">Still to pack</p>
        <p className="font-display mt-2 text-3xl font-semibold text-ink">{left.length === 0 ? "All packed" : left.length}</p>
        {left.length === 0 ? (
          <p className="mt-1 text-sm text-gold-ink">Every item is checked off.</p>
        ) : (
          <>
            <p className="text-sm text-gold-ink">{left.length === 1 ? "item left" : "items left"}</p>
            <ul className="mt-4 space-y-0.5">
              {byCategory.map(({ c, n }) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onShowRemaining(c.id)}
                    className="focus-ring flex min-h-9 w-full items-center justify-between gap-2 rounded-lg px-2 text-left text-sm text-ink hover:bg-white/60"
                  >
                    <span className="truncate">{c.name}</span>
                    <span className="font-semibold tabular-nums">{n}</span>
                  </button>
                </li>
              ))}
            </ul>
            {byTraveler.length > 0 ? (
              <div className="mt-4 border-t border-gold/60 pt-3">
                <p className="px-2 text-xs font-semibold tracking-wide text-gold-ink uppercase">By traveler</p>
                <ul className="mt-1 space-y-0.5 text-sm text-ink">
                  {byTraveler.map((t) => (
                    <li key={t.name} className="flex justify-between px-2 py-1">
                      <span className="truncate">{t.name}</span>
                      <span className="font-semibold tabular-nums">{t.n}</span>
                    </li>
                  ))}
                  {unassigned ? (
                    <li className="flex justify-between px-2 py-1 text-gold-ink">
                      <span>Not assigned</span>
                      <span className="font-semibold tabular-nums">{unassigned}</span>
                    </li>
                  ) : null}
                </ul>
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => onShowRemaining()}
              className="focus-ring mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-white/80 px-4 text-sm font-semibold text-ink hover:bg-white"
            >
              Show what’s left
            </button>
          </>
        )}
      </div>
    </aside>
  );
}

function EmptyState({
  copyAvailable,
  hasOtherTrips,
  onEmpty,
  onStarter,
  onCopy,
}: {
  copyAvailable: boolean;
  hasOtherTrips: boolean;
  onEmpty: () => void;
  onStarter: () => void;
  onCopy: () => void;
}) {
  const option =
    "focus-ring flex h-full w-full flex-col items-start gap-2 rounded-2xl border border-border bg-white p-5 text-left transition-colors hover:border-moss hover:bg-moss-soft/30 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border disabled:hover:bg-white";
  return (
    <div className="card-surface px-5 py-8 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-xl text-center">
        <MascotImage size="md" decorative className="mx-auto" />
        <h3 className="font-display mt-4 text-2xl font-semibold text-ink">Start your packing list</h3>
        <p className="mt-2 text-muted-foreground">Pick a starting point. Nothing is added until you choose.</p>
      </div>
      <ul className="mx-auto mt-8 grid max-w-3xl gap-3 sm:grid-cols-3">
        <li>
          <button type="button" className={option} onClick={onStarter}>
            <ListChecks className="size-5 text-moss-ink" aria-hidden="true" />
            <span className="font-semibold text-ink">Use a starter checklist</span>
            <span className="text-sm text-muted-foreground">Essentials, clothes, toiletries, baby, beach and electronics — pick what fits.</span>
          </button>
        </li>
        <li>
          <button type="button" className={option} onClick={onCopy} disabled={!copyAvailable}>
            <CopyPlus className="size-5 text-moss-ink" aria-hidden="true" />
            <span className="font-semibold text-ink">Copy from another trip</span>
            <span className="text-sm text-muted-foreground">
              {copyAvailable
                ? "Reuse a list you’ve made before. Everything starts unpacked."
                : hasOtherTrips
                  ? "None of your other trips has a packing list yet."
                  : "Available once you have another trip with a list."}
            </span>
          </button>
        </li>
        <li>
          <button type="button" className={option} onClick={onEmpty}>
            <Plus className="size-5 text-moss-ink" aria-hidden="true" />
            <span className="font-semibold text-ink">Start an empty list</span>
            <span className="text-sm text-muted-foreground">Name a first category and add your own items.</span>
          </button>
        </li>
      </ul>
    </div>
  );
}
