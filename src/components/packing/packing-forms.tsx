"use client";

import { useState } from "react";
import { toast } from "sonner";
import { savePackingCategory, savePackingItem } from "@/app/actions/packing";
import {
  FormMessage,
  SelectField,
  SubmitButton,
  TextAreaField,
  TextField,
  secondaryButtonClass,
} from "@/components/forms/fields";
import { ConflictGuard } from "@/components/forms/conflict";
import { useFormAction } from "@/components/forms/use-form-action";
import { zoneName } from "@/lib/reminders";
import type { MemberChoice } from "@/lib/reminders";
import type { ActionState, PackingCategory, PackingItem } from "@/lib/types";

/** Add or edit one checklist row. Packed state is left alone (the checkbox owns it). */
export function PackingItemForm({
  tripId,
  item,
  categories,
  defaultCategoryId,
  travelers,
  people,
  tripTimeZone,
  onCancel,
  onSaved,
}: {
  tripId: string;
  item?: PackingItem;
  categories: Pick<PackingCategory, "id" | "name">[];
  defaultCategoryId?: string;
  travelers: string[];
  people: MemberChoice[];
  tripTimeZone: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  // Becomes the new item's id, so a double submit can't add it twice.
  const [requestId] = useState(() => crypto.randomUUID());
  const { state, onSubmit, pending } = useFormAction(async (prev: ActionState, formData: FormData) => {
    const result = await savePackingItem(tripId, item?.id ?? null, prev, formData);
    if (result.ok) {
      toast.success(result.message);
      onSaved();
    }
    return result;
  });
  const errors = state.fieldErrors ?? {};

  return (
    <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
      {item ? null : <input type="hidden" name="request_id" value={requestId} />}
      <div className="flex-1 space-y-5 overflow-y-auto px-5 pb-6 sm:px-6">
        <FormMessage message={state.ok || state.conflict ? undefined : state.message} signedOut={state.signedOut} />
        <ConflictGuard state={state} expectedUpdatedAt={item?.updated_at} onDiscard={onCancel} />
        <TextField
          idPrefix="pi"
          name="label"
          label="Item"
          defaultValue={item?.label}
          required
          maxLength={120}
          autoComplete="off"
          autoFocus={!item}
          error={errors.label}
        />
        <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-4">
          <TextField
            idPrefix="pi"
            name="quantity"
            label="Quantity"
            type="number"
            inputMode="numeric"
            min={1}
            max={999}
            step={1}
            defaultValue={item?.quantity ?? 1}
            error={errors.quantity}
          />
          <SelectField
            idPrefix="pi"
            name="category_id"
            label="Category"
            defaultValue={item?.category_id ?? defaultCategoryId ?? categories[0]?.id}
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
            error={errors.category_id}
          />
        </div>
        <TextField
          idPrefix="pi"
          name="traveler_name"
          label="For"
          optional
          defaultValue={item?.traveler_name ?? ""}
          maxLength={40}
          autoComplete="off"
          list="packing-travelers"
          placeholder={travelers.length ? `e.g. ${travelers.slice(0, 2).join(" or ")}` : "A name, or leave blank"}
          hint="Just a label to help sort who it’s for."
          error={errors.traveler_name}
        />
        <datalist id="packing-travelers">
          {travelers.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <fieldset className="space-y-4 rounded-2xl border border-border bg-surface p-4">
          <legend className="px-1 text-sm font-semibold text-ink">Assign &amp; due date</legend>
          <SelectField
            idPrefix="pi"
            name="assignee_id"
            label="Assigned to"
            optional
            defaultValue={item?.assignee_id ?? ""}
            options={[{ value: "", label: "Nobody" }, ...people.map((p) => ({ value: p.id, label: p.isYou ? "You" : p.name }))]}
            hint="Someone on this trip. Reminders for a task go only to the person it’s assigned to."
            error={errors.assignee_id}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField idPrefix="pi" name="due_date" label="Due date" type="date" optional defaultValue={item?.due_date ?? ""} error={errors.due_date} />
            <TextField
              idPrefix="pi"
              name="due_time"
              label="Due time"
              type="time"
              optional
              defaultValue={item?.due_time ? item.due_time.slice(0, 5) : ""}
              hint={`In ${zoneName(item?.due_time_zone ?? tripTimeZone)}.`}
              error={errors.due_time}
            />
          </div>
          <p className="text-xs text-muted-foreground">A task isn’t given a deadline unless you set one, and nothing is sent unless you set up a reminder for it.</p>
        </fieldset>
        <TextAreaField
          idPrefix="pi"
          name="notes"
          label="Notes"
          optional
          defaultValue={item?.notes ?? ""}
          maxLength={1000}
          rows={3}
          error={errors.notes}
        />
      </div>
      <div className="flex flex-col-reverse gap-3 border-t border-border px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
        <button type="button" onClick={onCancel} className={secondaryButtonClass} disabled={pending}>
          Cancel
        </button>
        <SubmitButton pending={pending} pendingLabel="Saving…">
          {item ? "Save changes" : "Add item"}
        </SubmitButton>
      </div>
    </form>
  );
}

/** Name a new category or rename one. */
export function PackingCategoryForm({
  tripId,
  category,
  defaultName,
  onCancel,
  onSaved,
}: {
  tripId: string;
  category?: Pick<PackingCategory, "id" | "name">;
  defaultName?: string;
  onCancel: () => void;
  onSaved: (categoryId?: string) => void;
}) {
  const { state, onSubmit, pending } = useFormAction(async (prev: ActionState, formData: FormData) => {
    const result = await savePackingCategory(tripId, category?.id ?? null, prev, formData);
    if (result.ok) {
      toast.success(result.message);
      onSaved(result.categoryId);
    }
    return result;
  });
  const errors = state.fieldErrors ?? {};

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <FormMessage message={state.ok ? undefined : state.message} signedOut={state.signedOut} />
      <TextField
        idPrefix="pc"
        name="name"
        label="Category name"
        defaultValue={category?.name ?? defaultName ?? ""}
        required
        maxLength={60}
        autoComplete="off"
        autoFocus
        error={errors.name}
      />
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button type="button" onClick={onCancel} className={secondaryButtonClass} disabled={pending}>
          Cancel
        </button>
        <SubmitButton pending={pending} pendingLabel="Saving…">
          {category ? "Rename" : "Add category"}
        </SubmitButton>
      </div>
    </form>
  );
}
