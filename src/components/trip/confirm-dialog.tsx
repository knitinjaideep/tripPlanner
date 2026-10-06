"use client";

import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { secondaryButtonClass } from "@/components/forms/fields";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  pendingLabel?: string;
  cancelLabel?: string;
};

/** Destructive confirmation that stays open (with a spinner) until done. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  pendingLabel = "Deleting…",
  cancelLabel = "Keep it",
}: Props) {
  const [pending, startTransition] = useTransition();

  return (
    <AlertDialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <AlertDialogContent className="rounded-2xl p-6 sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display text-xl font-semibold text-ink">{title}</AlertDialogTitle>
          <AlertDialogDescription className="text-[0.9375rem] text-muted-foreground">
            {description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-3">
          <button
            type="button"
            className={secondaryButtonClass}
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={pending}
            aria-busy={pending}
            onClick={() => startTransition(onConfirm)}
            className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-destructive px-5 text-[0.9375rem] font-semibold text-white hover:bg-[#9a1d14] disabled:opacity-70"
          >
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            {pending ? pendingLabel : confirmLabel}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
