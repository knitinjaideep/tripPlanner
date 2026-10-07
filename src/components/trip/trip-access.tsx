"use client";

import { createContext, useContext, type ReactNode } from "react";
import { can, type TripRole } from "@/lib/sharing";

export type TripAccessValue = {
  tripId: string;
  role: TripRole;
  userId: string;
  /** More than one person has access — attribution and "shared" cues are worth showing. */
  shared: boolean;
  /** user id → display name, for "Added by …". */
  people: Record<string, string>;
  canEdit: boolean;
  isOwner: boolean;
};

const TripAccessContext = createContext<TripAccessValue | null>(null);

/** Server components compute the role from the database; this only mirrors it so the UI can hide what the server would refuse. */
export function TripAccessProvider({
  tripId,
  role,
  userId,
  shared,
  people,
  children,
}: {
  tripId: string;
  role: TripRole;
  userId: string;
  shared: boolean;
  people: Record<string, string>;
  children: ReactNode;
}) {
  return (
    <TripAccessContext.Provider
      value={{ tripId, role, userId, shared, people, canEdit: can(role, "contribute"), isOwner: role === "owner" }}
    >
      {children}
    </TripAccessContext.Provider>
  );
}

export function useTripAccess() {
  const ctx = useContext(TripAccessContext);
  if (!ctx) throw new Error("useTripAccess must be used inside <TripAccessProvider>");
  return ctx;
}

/** "Added by Eddie" / "Updated by Olive · Added by Eddie". Renders nothing on unshared trips or unknown people. */
export function Attribution({
  createdBy,
  updatedBy,
  className,
}: {
  createdBy?: string | null;
  updatedBy?: string | null;
  className?: string;
}) {
  const { shared, people, userId } = useTripAccess();
  if (!shared) return null;
  const name = (id?: string | null) => (id ? (id === userId ? "you" : people[id]) : undefined);
  const added = name(createdBy);
  const updated = updatedBy && updatedBy !== createdBy ? name(updatedBy) : undefined;
  if (!added && !updated) return null;
  const parts = [added ? `Added by ${added}` : null, updated ? `updated by ${updated}` : null].filter(Boolean);
  const text = parts.join(" · ");
  return <p className={className ?? "text-xs text-muted-foreground"}>{text.charAt(0).toUpperCase() + text.slice(1)}</p>;
}
