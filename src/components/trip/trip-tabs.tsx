"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Compass, Home, Images, Luggage, Ticket, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Tab = { label: string; icon: LucideIcon; href?: string };

export function TripTabs({ tripId }: { tripId: string }) {
  const pathname = usePathname();
  const base = `/trips/${tripId}`;
  const tabs: Tab[] = [
    { label: "Overview", icon: Home, href: base },
    { label: "Itinerary", icon: CalendarDays, href: `${base}/itinerary` },
    { label: "Bookings", icon: Ticket, href: `${base}/bookings` },
    { label: "Explore", icon: Compass, href: `${base}/explore` },
    { label: "Packing", icon: Luggage, href: `${base}/packing` },
    { label: "Memories", icon: Images, href: `${base}/memories` },
  ];

  return (
    <nav aria-label="Trip sections" className="border-b border-border">
      <ul className="relative -mb-px flex gap-1 overflow-x-auto [scrollbar-width:none] sm:gap-2 [&::-webkit-scrollbar]:hidden">
        {tabs.map(({ label, icon: Icon, href }) => {
          if (!href) {
            return (
              <li key={label} className="shrink-0">
                <span
                  aria-disabled="true"
                  title={`${label} is coming soon`}
                  className="flex min-h-12 cursor-not-allowed items-center gap-2 px-3 text-[0.9375rem] font-medium text-[#8a979f] select-none"
                >
                  <Icon className="size-[18px]" aria-hidden="true" />
                  {label}
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-[0.6875rem] font-semibold tracking-wide text-muted-foreground">
                    Soon<span className="sr-only"> — coming soon, not available yet</span>
                  </span>
                </span>
              </li>
            );
          }
          const active = pathname === href;
          return (
            <li key={label} className="shrink-0">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "focus-ring flex min-h-12 items-center gap-2 rounded-t-lg border-b-[3px] px-3 text-[0.9375rem] font-medium transition-colors",
                  active
                    ? "border-teal text-teal-ink"
                    : "border-transparent text-ink hover:border-border hover:text-teal-ink",
                )}
              >
                <Icon className="size-[18px]" aria-hidden="true" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
