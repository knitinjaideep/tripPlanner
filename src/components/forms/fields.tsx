import type { ComponentProps, ReactNode } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export const controlClass =
  "h-11 rounded-[10px] border-input bg-white px-3.5 text-[0.9375rem] text-ink shadow-none placeholder:text-[#8a979f] focus-visible:border-teal focus-visible:ring-3 focus-visible:ring-teal/25 aria-invalid:border-destructive aria-invalid:ring-destructive/15 md:text-[0.9375rem]";

type FieldShellProps = {
  id: string;
  label: string;
  error?: string[];
  hint?: string;
  optional?: boolean;
  className?: string;
  children: ReactNode;
};

export function FieldShell({ id, label, error, hint, optional, className, children }: FieldShellProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
        {optional ? <span className="font-normal text-muted-foreground">(optional)</span> : null}
      </Label>
      {children}
      {error?.length ? (
        <p id={`${id}-error`} className="flex items-center gap-1.5 text-sm text-destructive">
          <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
          {error[0]}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(id: string, error?: string[], hint?: string) {
  if (error?.length) return `${id}-error`;
  if (hint) return `${id}-hint`;
  return undefined;
}

type TextFieldProps = Omit<ComponentProps<"input">, "id"> & {
  name: string;
  label: string;
  error?: string[];
  hint?: string;
  optional?: boolean;
  wrapperClassName?: string;
  idPrefix?: string;
};

export function TextField({
  name,
  label,
  error,
  hint,
  optional,
  wrapperClassName,
  idPrefix = "f",
  className,
  ...props
}: TextFieldProps) {
  const id = `${idPrefix}-${name}`;
  return (
    <FieldShell id={id} label={label} error={error} hint={hint} optional={optional} className={wrapperClassName}>
      <Input
        id={id}
        name={name}
        aria-invalid={error?.length ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={cn(controlClass, className)}
        {...props}
      />
    </FieldShell>
  );
}

type TextAreaFieldProps = Omit<ComponentProps<"textarea">, "id"> & {
  name: string;
  label: string;
  error?: string[];
  hint?: string;
  optional?: boolean;
  idPrefix?: string;
};

export function TextAreaField({
  name,
  label,
  error,
  hint,
  optional,
  idPrefix = "f",
  className,
  ...props
}: TextAreaFieldProps) {
  const id = `${idPrefix}-${name}`;
  return (
    <FieldShell id={id} label={label} error={error} hint={hint} optional={optional}>
      <Textarea
        id={id}
        name={name}
        aria-invalid={error?.length ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={cn(controlClass, "h-auto min-h-24 py-2.5", className)}
        {...props}
      />
    </FieldShell>
  );
}

export function FormMessage({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex gap-2.5 rounded-xl border border-[#f3c6bf] bg-[#fff1ee] p-3.5 text-sm text-[#8c2b1f]">
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p>{message}</p>
    </div>
  );
}

export function SubmitButton({
  pending,
  children,
  pendingLabel,
  className,
}: {
  pending: boolean;
  children: ReactNode;
  pendingLabel: string;
  className?: string;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={cn(
        "focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-coral px-5 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-coral-hover disabled:cursor-not-allowed disabled:opacity-70",
        className,
      )}
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
      {pending ? pendingLabel : children}
    </button>
  );
}

export const secondaryButtonClass =
  "focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-input bg-white px-5 text-[0.9375rem] font-semibold text-ink transition-colors hover:bg-secondary disabled:opacity-60";
