"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function CopyButton({ value, label, className }: { value: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          toast.success(`${label} copied.`);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          toast.error("Couldn’t copy — select the text instead.");
        }
      }}
      className={cn(
        "focus-ring inline-grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-ink",
        className,
      )}
      aria-label={`Copy ${label.toLowerCase()}`}
    >
      {copied ? <Check className="size-4 text-moss-ink" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
    </button>
  );
}
