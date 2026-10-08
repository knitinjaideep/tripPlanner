"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { NotificationList } from "@/components/notifications/notification-list";
import { useNotificationsContext } from "@/components/notifications/notifications-provider";
import { unreadBadge } from "@/lib/notifications";
import { cn } from "@/lib/utils";

const buttonClass =
  "focus-ring relative inline-flex size-11 items-center justify-center rounded-full text-ink hover:bg-secondary aria-expanded:bg-secondary";

/**
 * The bell with its unread count.
 *
 * Phones and narrow windows (below `md`, which includes a narrow Split View)
 * get a plain link to the full-screen inbox route; wider windows get a
 * compact panel anchored to the bell. Both are in the markup and CSS picks
 * one, so there is no layout jump and no script is needed to choose.
 */
export function NotificationBell() {
  const { unread, announcement } = useNotificationsContext();
  const [open, setOpen] = useState(false);
  const label = unread > 0 ? `Notifications, ${unread} unread` : "Notifications";
  const badge =
    unread > 0 ? (
      <span
        aria-hidden="true"
        className="absolute -top-0.5 -right-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-gold px-1 text-[0.6875rem] leading-none font-bold text-ink ring-2 ring-background"
      >
        {unreadBadge(unread)}
      </span>
    ) : null;

  return (
    <>
      <Link href="/notifications" aria-label={label} className={cn(buttonClass, "md:hidden")}>
        <Bell className="size-5" aria-hidden="true" />
        {badge}
      </Link>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger aria-label={label} className={cn(buttonClass, "hidden md:inline-flex")}>
          <Bell className="size-5" aria-hidden="true" />
          {badge}
        </PopoverTrigger>
        <PopoverContent aria-label="Notifications" className="flex max-h-[min(36rem,calc(100dvh-5rem))] flex-col">
          <h2 className="font-display border-b border-border/70 px-4 pt-3.5 pb-2.5 text-lg font-semibold text-ink">Notifications</h2>
          <div className="flex min-h-0 flex-1 flex-col">
            <NotificationList variant="popover" onNavigate={() => setOpen(false)} />
          </div>
        </PopoverContent>
      </Popover>
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </>
  );
}
