"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { secondaryButtonClass } from "@/components/forms/fields";

/**
 * A form dialog that won't silently lose typing: closing it (Esc, the X,
 * clicking outside, Cancel) while the form has unsaved edits asks first,
 * and leaving the page warns through the browser. It can't be closed while
 * a save is in flight.
 */
export function EditDialog({
  open,
  onClose,
  dirty,
  pending,
  title,
  description,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  dirty: boolean;
  pending: boolean;
  title: string;
  description: string;
  /** Receives the guarded close, for the form's own Cancel button. */
  children: (requestClose: () => void) => ReactNode;
  wide?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [open, dirty]);

  function requestClose() {
    if (pending) return;
    if (dirty) setConfirming(true);
    else onClose();
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !next && requestClose()}>
        <DialogContent
          ref={contentRef}
          className={
            "max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto rounded-2xl bg-background p-5 sm:p-6 " +
            (wide ? "sm:max-w-xl" : "sm:max-w-md")
          }
        >
          <DialogHeader className="pr-10">
            <DialogTitle className="font-display text-2xl leading-tight font-semibold text-ink">{title}</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">{description}</DialogDescription>
          </DialogHeader>
          {children(requestClose)}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent
          className="rounded-2xl p-6 sm:max-w-sm"
          // No trigger to return to: put focus back in the form being edited.
          onCloseAutoFocus={(event) => {
            const field = contentRef.current?.querySelector<HTMLElement>("input:not([type=hidden]), textarea, select");
            if (field) {
              event.preventDefault();
              field.focus();
            }
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-xl font-semibold text-ink">Discard your changes?</AlertDialogTitle>
            <AlertDialogDescription className="text-[0.9375rem] text-muted-foreground">
              What you typed here hasn’t been saved yet.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-3">
            <button type="button" className={secondaryButtonClass} onClick={() => setConfirming(false)}>
              Keep editing
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                onClose();
              }}
              className="focus-ring inline-flex min-h-11 items-center justify-center rounded-xl bg-destructive px-5 text-[0.9375rem] font-semibold text-white hover:bg-[#9a1d14]"
            >
              Discard
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Tracks whether a form has been edited since it opened. Pass `onInput` to the form. */
export function useDirty() {
  const [dirty, setDirty] = useState(false);
  return { dirty, markDirty: () => setDirty(true), reset: () => setDirty(false) };
}
