"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { NotificationList } from "@/components/notifications/notification-list";
import type { NotificationPage } from "@/lib/notifications";

/** The full-screen inbox: what phones, iPad Split View and "Open the full inbox" lead to. */
export function InboxPage({ initial, serverNow }: { initial: NotificationPage | null; serverNow: string }) {
  const router = useRouter();
  const heading = useRef<HTMLHeadingElement>(null);

  // Land on the heading so screen-reader and keyboard users start at the top of the inbox.
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);

  return (
    <main
      className="mx-auto w-full max-w-2xl px-[max(1rem,env(safe-area-inset-left))] pt-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-8"
    >
      <div className="mb-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => (window.history.length > 1 ? router.back() : router.push("/trips"))}
          className="focus-ring -ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-moss-ink hover:bg-moss-soft"
        >
          <ArrowLeft className="size-4" aria-hidden="true" /> Back
        </button>
      </div>
      <h1 ref={heading} tabIndex={-1} className="font-display mb-3 text-3xl font-semibold text-ink outline-hidden">
        Notifications
      </h1>
      <NotificationList variant="page" initial={initial ?? undefined} serverNow={serverNow} />
    </main>
  );
}
