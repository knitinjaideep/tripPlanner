"use client";

import { ExternalLink, FileText, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { DriveIcon } from "@/components/brand";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { documentHost, documentSource } from "@/lib/documents";
import type { TripDocument } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useTripAccess } from "./trip-access";
import { useTripWorkspace } from "./trip-workspace";

export function DocumentIcon({ url, className }: { url: string; className?: string }) {
  const source = documentSource(url);
  return (
    <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl bg-white ring-1 ring-border", className)}>
      {source === "other" ? (
        <FileText className="size-[18px] text-earth-ink" aria-hidden="true" />
      ) : (
        <DriveIcon className="size-[18px]" />
      )}
    </span>
  );
}

const SOURCE_LABEL = { drive: "Google Drive", docs: "Google Docs", sheets: "Google Sheets" } as const;

export function DocumentRow({ doc, context }: { doc: TripDocument; context?: string | null }) {
  const { editDocument, removeDocument } = useTripWorkspace();
  const { canEdit } = useTripAccess();
  const source = documentSource(doc.url);
  const sub = [source === "other" ? documentHost(doc.url) : SOURCE_LABEL[source], context].filter(Boolean).join(" · ");

  return (
    <li className="flex items-center gap-1 rounded-xl bg-white/90 ring-1 ring-border/70">
      <a
        href={doc.url}
        target="_blank"
        rel="noopener noreferrer"
        className="focus-ring flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-xl py-2 pl-2.5 hover:bg-white"
      >
        <DocumentIcon url={doc.url} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink">{doc.label}</span>
          <span className="block truncate text-xs text-muted-foreground">{sub}</span>
        </span>
        <ExternalLink className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">(opens in a new tab)</span>
      </a>
      {canEdit ? (
      <DropdownMenu>
        <DropdownMenuTrigger
          className="focus-ring mr-1 grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-ink"
          aria-label={`Options for ${doc.label}`}
        >
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="rounded-xl p-1.5">
          <DropdownMenuItem className="min-h-11 rounded-lg" onSelect={() => editDocument(doc)}>
            <Pencil aria-hidden="true" /> Edit link
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" className="min-h-11 rounded-lg" onSelect={() => removeDocument(doc)}>
            <Trash2 aria-hidden="true" /> Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      ) : null}
    </li>
  );
}
