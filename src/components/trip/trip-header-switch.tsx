"use client";

import type { ReactNode } from "react";
import { useSelectedLayoutSegment } from "next/navigation";

/** Full hero on the trip overview; the compact header on every inner tab. */
export function TripHeaderSwitch({ full, compact }: { full: ReactNode; compact: ReactNode }) {
  return useSelectedLayoutSegment() === null ? full : compact;
}
