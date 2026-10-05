"use client";

import { useTransition } from "react";
import Link from "next/link";
import { ChevronDown, Loader2, LogOut, Map } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/user-avatar";
import { signOut } from "@/app/actions/auth";

type Props = {
  name: string;
  email: string | null;
  initials: string;
  avatarUrl: string | null;
};

export function AccountMenu({ name, email, initials, avatarUrl }: Props) {
  const [pending, startTransition] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="focus-ring flex min-h-11 items-center gap-1.5 rounded-full p-0.5 pr-1.5 hover:bg-secondary"
        aria-label={`Account menu for ${name}`}
      >
        <UserAvatar name={name} initials={initials} src={avatarUrl} />
        <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-64 rounded-xl p-1.5">
        <DropdownMenuLabel className="px-2.5 py-2 font-normal">
          <p className="truncate text-sm font-semibold text-ink">{name}</p>
          {email ? <p className="truncate text-xs text-muted-foreground">{email}</p> : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="min-h-11 rounded-lg px-2.5 text-sm">
          <Link href="/trips">
            <Map aria-hidden="true" /> My trips
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="min-h-11 rounded-lg px-2.5 text-sm"
          disabled={pending}
          onSelect={(event) => {
            event.preventDefault();
            startTransition(() => signOut());
          }}
        >
          {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <LogOut aria-hidden="true" />}
          {pending ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
