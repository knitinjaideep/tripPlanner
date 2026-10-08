"use client";

import { useState } from "react";
import { MessageCircleQuestionMark } from "lucide-react";
import { useTripAccess } from "@/components/trip/trip-access";
import { cn } from "@/lib/utils";
import { PollFormDialog, type PollParent } from "./poll-form";

/** "Ask the group" — shown only to people who can create polls (owners and editors); the server enforces it too. */
export function AskGroupButton({
  parent,
  places,
  tripTimeZone,
  scopeLabel,
  seedPlaceId,
  label = "Ask the group",
  className,
}: {
  parent: PollParent;
  places: { id: string; name: string }[];
  tripTimeZone: string;
  scopeLabel?: string | null;
  seedPlaceId?: string;
  label?: string;
  className?: string;
}) {
  const { canEdit } = useTripAccess();
  const [open, setOpen] = useState(false);
  if (!canEdit) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "focus-ring inline-flex min-h-11 items-center gap-2 rounded-xl border-[1.5px] border-moss-ink px-4 text-[0.9375rem] font-semibold text-moss-ink transition-colors hover:bg-moss-soft",
          className,
        )}
      >
        <MessageCircleQuestionMark className="size-4" aria-hidden="true" /> {label}
      </button>
      <PollFormDialog
        mode={{ kind: "new", parent, seedPlaceId }}
        open={open}
        onOpenChange={setOpen}
        places={places}
        tripTimeZone={tripTimeZone}
        scopeLabel={scopeLabel}
      />
    </>
  );
}
