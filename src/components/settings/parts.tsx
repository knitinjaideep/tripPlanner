"use client";

import { useCallback, useId, useRef, useState, type ReactNode } from "react";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SettingsActionState } from "@/app/actions/settings";
import type { SettingsSnapshot } from "@/lib/settings";

/* ------------------------------ save logic ------------------------------ */

export type SaveStatus = { state: "idle" } | { state: "saving" } | { state: "saved"; message: string } | { state: "error"; message: string; signedOut?: boolean };

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Only the fields that differ from what is saved — a partial update never touches the rest. */
export function changedFields<T extends Record<string, unknown>>(saved: T, draft: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(draft) as (keyof T)[]) if (!sameValue(saved[key], draft[key])) out[key] = draft[key];
  return out;
}

/**
 * Draft / save state for one section. The draft is local and survives a failed
 * save untouched. "Saved" is shown only after the server answered ok, and the
 * draft is then replaced by the values the server says it stored.
 */
export function useSectionForm<T extends Record<string, unknown>>({
  saved,
  save,
  pick,
  onSaved,
}: {
  saved: T;
  save: (patch: Partial<T>) => Promise<SettingsActionState>;
  /** Reads this section back out of the confirmed snapshot. */
  pick: (snapshot: SettingsSnapshot) => T;
  onSaved: (snapshot: SettingsSnapshot) => void;
}) {
  const [draft, setDraft] = useState<T>(saved);
  const [status, setStatus] = useState<SaveStatus>({ state: "idle" });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[] | undefined>>({});
  const inFlight = useRef(false);
  const dirty = !sameValue(saved, draft);

  const update = useCallback((patch: Partial<T>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setStatus((s) => (s.state === "saving" ? s : { state: "idle" }));
    setFieldErrors({});
  }, []);

  const reset = useCallback(() => {
    setDraft(saved);
    setStatus({ state: "idle" });
    setFieldErrors({});
  }, [saved]);

  const submit = useCallback(async () => {
    if (inFlight.current) return;
    const patch = changedFields(saved, draft);
    if (Object.keys(patch).length === 0) return;
    inFlight.current = true;
    setStatus({ state: "saving" });
    setFieldErrors({});
    try {
      const result = await save(patch);
      if (result.ok && result.settings) {
        setDraft(pick(result.settings));
        onSaved(result.settings);
        setStatus({ state: "saved", message: result.message ?? "Saved." });
      } else {
        setFieldErrors(result.fieldErrors ?? {});
        setStatus({ state: "error", message: result.message ?? "That didn’t save. Your changes are still here — try again.", signedOut: result.signedOut });
      }
    } catch {
      // Network failure or a server error page: nothing is known to be saved.
      setStatus({ state: "error", message: "We couldn’t reach Atlas, so nothing was saved. Your changes are still here — check your connection and try again." });
    } finally {
      inFlight.current = false;
    }
  }, [draft, onSaved, pick, save, saved]);

  return { draft, update, setDraft, reset, submit, status, setStatus, dirty, fieldErrors };
}

/* -------------------------------- chrome -------------------------------- */

export const primaryButton =
  "focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-moss-ink px-5 text-[0.9375rem] font-semibold text-white hover:bg-moss-hover disabled:cursor-not-allowed disabled:opacity-60";
export const quietButton =
  "focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-input bg-white px-4 text-[0.9375rem] font-semibold text-ink hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60";

export function SectionCard({ id, title, intro, children }: { id: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-[0_1px_2px_rgba(24,58,47,0.04),0_10px_28px_-14px_rgba(24,58,47,0.12)] sm:p-6">
      <h2 id={`${id}-heading`} className="font-display text-2xl font-semibold text-ink">
        {title}
      </h2>
      {intro ? <div className="mt-1.5 text-[0.9375rem] text-muted-foreground">{intro}</div> : null}
      <div className="mt-5 space-y-6">{children}</div>
    </div>
  );
}

export function Group({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  const hintId = useId();
  return (
    <fieldset className={cn("min-w-0 space-y-2.5", className)} aria-describedby={hint ? hintId : undefined}>
      <legend className="text-sm font-semibold text-ink">{label}</legend>
      {hint ? (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {children}
    </fieldset>
  );
}

/** Radio buttons drawn as a row of big, labelled choices. Real inputs: arrow keys, labels and the checked state are native. */
export function Segmented<V extends string>({
  name,
  value,
  options,
  onChange,
  disabled,
}: {
  name: string;
  value: V | null;
  options: readonly { value: V; label: string; hint?: string }[];
  onChange: (value: V) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-2 sm:flex sm:flex-wrap" style={{ gridTemplateColumns: `repeat(${Math.min(options.length, 2)}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <label
          key={o.value}
          className={cn(
            "relative flex min-h-11 min-w-0 cursor-pointer items-center justify-center gap-2 rounded-xl border px-4 py-2 text-center text-[0.9375rem] font-semibold has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-moss/40 has-[:focus-visible]:ring-offset-2",
            value === o.value ? "border-moss-ink bg-moss-soft text-moss-ink" : "border-input bg-white text-ink hover:bg-secondary",
            disabled && "cursor-not-allowed opacity-60",
          )}
        >
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            disabled={disabled}
            onChange={() => onChange(o.value)}
            className="peer sr-only"
          />
          {value === o.value ? <Check className="size-4 shrink-0" aria-hidden="true" /> : null}
          <span className="min-w-0">
            {o.label}
            {o.hint ? <span className="block text-xs font-normal text-muted-foreground">{o.hint}</span> : null}
          </span>
        </label>
      ))}
    </div>
  );
}

/** Pressable chips for "pick any". Real checkboxes under the styling. */
export function ChipSet<V extends string>({
  name,
  values,
  options,
  onChange,
}: {
  name: string;
  values: readonly V[];
  options: Record<V, string>;
  onChange: (next: V[]) => void;
}) {
  const keys = Object.keys(options) as V[];
  return (
    <div className="flex flex-wrap gap-2">
      {keys.map((key) => {
        const on = values.includes(key);
        return (
          <label
            key={key}
            className={cn(
              "flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border px-4 text-sm font-semibold has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-moss/40 has-[:focus-visible]:ring-offset-2",
              on ? "border-moss-ink bg-moss-soft text-moss-ink" : "border-input bg-white text-ink hover:bg-secondary",
            )}
          >
            <input
              type="checkbox"
              name={name}
              value={key}
              checked={on}
              onChange={(e) => onChange(keys.filter((k) => (k === key ? e.target.checked : values.includes(k))))}
              className="sr-only"
            />
            {on ? <Check className="size-4" aria-hidden="true" /> : null}
            {options[key]}
          </label>
        );
      })}
    </div>
  );
}

export function CheckRow({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={cn("flex min-h-11 cursor-pointer items-start gap-3 py-1.5 text-[0.9375rem] text-ink", disabled && "cursor-not-allowed opacity-60")}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="focus-ring mt-0.5 size-6 shrink-0 accent-[#3E7A3A]"
      />
      <span className="min-w-0">
        <span className="block font-semibold">{label}</span>
        {description ? <span className="block text-sm text-muted-foreground">{description}</span> : null}
      </span>
    </label>
  );
}

/**
 * Save / Cancel row with a polite live region. "Saved" and the error text are
 * announced to screen readers; the bar sits in the page flow (not fixed), so
 * it can never cover a focused field.
 */
export function SaveBar({
  dirty,
  status,
  saveLabel,
  onSave,
  onCancel,
  extra,
}: {
  dirty: boolean;
  status: SaveStatus;
  saveLabel: string;
  onSave: () => void;
  onCancel: () => void;
  extra?: ReactNode;
}) {
  const saving = status.state === "saving";
  return (
    <div className="border-t border-border pt-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <button type="button" onClick={onSave} disabled={!dirty || saving} className={primaryButton}>
          {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {saving ? "Saving…" : saveLabel}
        </button>
        <button type="button" onClick={onCancel} disabled={!dirty || saving} className={quietButton}>
          Cancel
        </button>
        {extra}
      </div>
      <div className="mt-3 min-h-6" aria-live="polite" role="status">
        {status.state === "saved" ? (
          <p className="flex items-center gap-1.5 text-sm font-semibold text-moss-ink">
            <Check className="size-4" aria-hidden="true" /> {status.message}
          </p>
        ) : status.state === "saving" ? (
          <p className="text-sm text-muted-foreground">Saving…</p>
        ) : dirty ? (
          <p className="text-sm text-muted-foreground">You have unsaved changes.</p>
        ) : null}
      </div>
      {status.state === "error" ? (
        <p role="alert" className="mt-1 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            {status.message}
            {status.signedOut ? (
              <>
                {" "}
                <a className="font-semibold underline" href="/login?next=%2Fsettings">
                  Sign in again
                </a>
              </>
            ) : null}
          </span>
        </p>
      ) : null}
    </div>
  );
}
