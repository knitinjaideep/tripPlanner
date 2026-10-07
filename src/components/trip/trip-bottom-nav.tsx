"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Compass, Home, Images, Luggage, MoreHorizontal, Ticket, type LucideIcon } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type Item = { label: string; icon: LucideIcon; href: string };

/**
 * Phone / narrow-window navigation: four sections and "More" (Packing,
 * Memories). The wider layouts use the top tabs instead, so only one of the
 * two is ever shown. Links carry the trip id, so switching sections keeps
 * the trip selected.
 */
export function TripBottomNav({ tripId }: { tripId: string }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const base = `/trips/${tripId}`;
  const primary: Item[] = [
    { label: "Overview", icon: Home, href: base },
    { label: "Itinerary", icon: CalendarDays, href: `${base}/itinerary` },
    { label: "Bookings", icon: Ticket, href: `${base}/bookings` },
    { label: "Explore", icon: Compass, href: `${base}/explore` },
  ];
  const more: Item[] = [
    { label: "Packing", icon: Luggage, href: `${base}/packing` },
    { label: "Memories", icon: Images, href: `${base}/memories` },
  ];
  const moreActive = more.some((m) => pathname === m.href);

  const itemClass = (active: boolean) =>
    cn(
      "focus-ring flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[0.6875rem] font-semibold transition-colors",
      active ? "text-moss-ink" : "text-muted-foreground hover:text-ink",
    );

  return (
    <>
      <nav
        aria-label="Trip sections"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden print:hidden"
      >
        <ul className="mx-auto flex max-w-xl items-stretch gap-0.5 px-1.5 pt-1">
          {primary.map(({ label, icon: Icon, href }) => {
            const active = pathname === href;
            return (
              <li key={label} className="flex min-w-0 flex-1">
                <Link href={href} aria-current={active ? "page" : undefined} className={itemClass(active)}>
                  <Icon className={cn("size-[22px]", active && "stroke-[2.4]")} aria-hidden="true" />
                  <span className="max-w-full truncate">{label}</span>
                </Link>
              </li>
            );
          })}
          <li className="flex min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              className={itemClass(moreActive)}
            >
              <MoreHorizontal className="size-[22px]" aria-hidden="true" />
              <span>More</span>
              {moreActive ? <span className="sr-only">(current section is in this menu)</span> : null}
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="gap-0 rounded-t-2xl bg-background pb-[env(safe-area-inset-bottom)]">
          <SheetHeader className="px-5 pt-5 pb-2 pr-16">
            <SheetTitle className="font-display text-xl font-semibold text-ink">More of this trip</SheetTitle>
            <SheetDescription className="sr-only">Other sections of this trip.</SheetDescription>
          </SheetHeader>
          <ul className="space-y-1 px-3 pb-4">
            {more.map(({ label, icon: Icon, href }) => (
              <li key={label}>
                <Link
                  href={href}
                  onClick={() => setMoreOpen(false)}
                  aria-current={pathname === href ? "page" : undefined}
                  className={cn(
                    "focus-ring flex min-h-14 items-center gap-3 rounded-xl px-3 text-base font-semibold text-ink hover:bg-secondary",
                    pathname === href && "bg-moss-soft text-moss-ink",
                  )}
                >
                  <Icon className="size-5" aria-hidden="true" /> {label}
                </Link>
              </li>
            ))}
          </ul>
        </SheetContent>
      </Sheet>
    </>
  );
}
