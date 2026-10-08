import Link from "next/link";
import { Logo } from "@/components/brand";
import { AccountMenu } from "@/components/account-menu";
import { NotificationBell } from "@/components/notifications/notification-bell";
import type { CurrentUser } from "@/lib/user";

export function SiteHeader({ user }: { user: CurrentUser }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Logo />
        <nav aria-label="Account" className="flex items-center gap-2 sm:gap-6">
          <Link
            href="/trips"
            className="focus-ring hidden min-h-11 items-center rounded-lg px-2 text-[0.9375rem] font-medium text-ink hover:text-moss-ink sm:inline-flex"
          >
            My trips
          </Link>
          <NotificationBell />
          <AccountMenu
            name={user.displayName}
            email={user.email}
            initials={user.initials}
            avatarUrl={user.avatarUrl}
          />
        </nav>
      </div>
    </header>
  );
}
