"use client";

import { useState } from "react";
import Link from "next/link";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteTrip } from "@/app/actions/trips";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "./confirm-dialog";

export function TripActions({ tripId, title, className }: { tripId: string; title: string; className?: string }) {
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "focus-ring grid size-11 shrink-0 place-items-center rounded-xl bg-white/90 text-ink shadow-sm backdrop-blur hover:bg-white",
            className,
          )}
          aria-label="Trip options"
        >
          <MoreHorizontal className="size-5" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={8} className="w-52 rounded-xl p-1.5">
          <DropdownMenuItem asChild className="min-h-11 rounded-lg">
            <Link href={`/trips/${tripId}/edit`}>
              <Pencil aria-hidden="true" /> Edit trip
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" className="min-h-11 rounded-lg" onSelect={() => setConfirming(true)}>
            <Trash2 aria-hidden="true" /> Delete trip
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Delete this trip?"
        description={`“${title}” and all of its bookings and document links will be permanently deleted. Files in Google Drive are not affected.`}
        confirmLabel="Delete trip"
        onConfirm={async () => {
          const result = await deleteTrip(tripId);
          // On success the action redirects; we only get here on failure.
          if (!result.ok) toast.error(result.message ?? "Couldn’t delete the trip.");
        }}
      />
    </>
  );
}
