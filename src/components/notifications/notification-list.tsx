"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlarmClock,
  BarChart3,
  Bell,
  CalendarClock,
  CheckCheck,
  CircleCheckBig,
  Loader2,
  MailPlus,
  Moon,
  UserCheck,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { markAllNotificationsRead, markNotificationRead, openNotification } from "@/app/actions/notifications";
import { MascotEmptyState } from "@/components/mascot";
import { useNotificationsContext } from "@/components/notifications/notifications-provider";
import { ReminderActions } from "@/components/notifications/reminder-actions";
import {
  effectiveTimeZone,
  groupByDay,
  timeLabel,
  type NotificationFilter,
  type NotificationItem,
  type NotificationPage,
  type NotificationType,
} from "@/lib/notifications";
import { cn } from "@/lib/utils";

/** Every type needs an icon: adding one to the registry fails the build until it has one. */
const ICONS: Record<NotificationType, LucideIcon> = {
  invitation_received: MailPlus,
  invitation_accepted: UserCheck,
  itinerary_changed: CalendarClock,
  poll_vote_needed: BarChart3,
  poll_result: CircleCheckBig,
  evening_preview: Moon,
  reminder: AlarmClock,
};

type Props = {
  variant: "page" | "popover";
  /** First page rendered on the server (page variant, "All" filter). */
  initial?: NotificationPage;
  /** ISO time of the server render, so the first paint matches the server's. */
  serverNow?: string;
  /** Called after navigating away (the popover closes itself). */
  onNavigate?: () => void;
};

const PAGE = 20;

/** Newest first; both strings are the same fixed-width UTC format, so text comparison is chronological. */
const byNewest = (a: NotificationItem, b: NotificationItem) =>
  a.created_at === b.created_at ? (a.id < b.id ? 1 : -1) : a.created_at < b.created_at ? 1 : -1;

export function NotificationList({ variant, initial, serverNow, onNavigate }: Props) {
  const router = useRouter();
  const ctx = useNotificationsContext();
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [items, setItems] = useState<NotificationItem[]>(initial?.items ?? []);
  const [nextCursor, setNextCursor] = useState<string | null>(initial?.nextCursor ?? null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(initial ? "ready" : "loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyAll, setBusyAll] = useState(false);
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => (serverNow ? new Date(serverNow) : new Date()));
  const [zone, setZone] = useState(() => effectiveTimeZone(ctx.timeZone, null));
  const seq = useRef(0);
  const filterRef = useRef(filter);

  // The configured zone, else this browser's, else UTC. Resolved after mount so the first paint matches the server.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only fallback
    setZone(effectiveTimeZone(ctx.timeZone, Intl.DateTimeFormat().resolvedOptions().timeZone));
  }, [ctx.timeZone]);

  // "Today / Yesterday" stay right if the tab is left open across midnight.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const fetchPage = useCallback(async (which: NotificationFilter, cursor: string | null) => {
    const params = new URLSearchParams({ filter: which, limit: String(PAGE) });
    if (cursor) params.set("cursor", cursor);
    const response = await fetch(`/api/notifications?${params}`, { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) throw new Error(String(response.status));
    return (await response.json()) as NotificationPage;
  }, []);

  /** Replace (filter change / first load) or merge (background refresh) the first page. */
  const load = useCallback(
    async (which: NotificationFilter, mode: "replace" | "merge") => {
      const mine = ++seq.current;
      if (mode === "replace") setStatus("loading");
      try {
        const page = await fetchPage(which, null);
        if (mine !== seq.current || which !== filterRef.current) return;
        setItems((current) => {
          if (mode === "replace") return page.items;
          // Keep older pages the person already loaded; refresh everything the first page covers.
          const last = page.items[page.items.length - 1];
          const older = page.nextCursor && last ? current.filter((i) => byNewest(i, last) > 0 && !page.items.some((p) => p.id === i.id)) : [];
          return [...page.items, ...older].sort(byNewest);
        });
        setNextCursor((cursor) => (mode === "merge" && cursor && page.nextCursor ? cursor : page.nextCursor));
        ctx.setUnread(page.unread);
        setStatus("ready");
      } catch {
        if (mine === seq.current && mode === "replace") setStatus("error");
      }
    },
    [fetchPage, ctx],
  );

  // First load (popover, or page without server data), and refetch whenever the bell's summary changed.
  const revisionSeen = useRef(ctx.revision);
  const first = useRef(true);
  useEffect(() => {
    const isFirst = first.current;
    first.current = false;
    if (isFirst && initial) return;
    void load(filter, isFirst ? "replace" : "merge");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (ctx.revision === revisionSeen.current) return;
    revisionSeen.current = ctx.revision;
    void load(filterRef.current, "merge");
  }, [ctx.revision, load]);

  const changeFilter = (next: NotificationFilter) => {
    if (next === filter) return;
    setFilter(next);
    filterRef.current = next;
    setItems([]);
    setNextCursor(null);
    void load(next, "replace");
  };

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(filter, nextCursor);
      setItems((current) => [...current, ...page.items.filter((p) => !current.some((c) => c.id === p.id))]);
      setNextCursor(page.nextCursor);
    } catch {
      setNotice("Couldn’t load more. Check your connection and try again.");
    } finally {
      setLoadingMore(false);
    }
  };

  const markLocalRead = (id: string) => {
    const target = items.find((i) => i.id === id);
    if (!target || target.read_at) return;
    if (target.available) ctx.adjustUnread(-1);
    const stamp = new Date().toISOString();
    setItems((current) => current.map((i) => (i.id === id && !i.read_at ? { ...i, read_at: stamp } : i)));
  };

  const markOne = async (item: NotificationItem) => {
    markLocalRead(item.id);
    setNote("Marked as read.");
    const result = await markNotificationRead(item.id);
    if (!result.ok) {
      setNotice("Couldn’t save that. It will show as unread again.");
      void load(filterRef.current, "merge");
    }
    void ctx.refresh();
  };

  const markAll = async () => {
    const newest = items[0]?.created_at ?? null;
    if (!newest || busyAll) return;
    setBusyAll(true);
    const result = await markAllNotificationsRead(newest);
    setBusyAll(false);
    if (!result.ok) {
      setNotice(result.signedOut ? "Your session has ended. Sign in again." : "Couldn’t mark everything as read. Please try again.");
      return;
    }
    const stamp = new Date().toISOString();
    setItems((current) => current.map((i) => (i.read_at || i.created_at > newest ? i : { ...i, read_at: stamp })));
    setNote("All notifications marked as read.");
    await ctx.refresh();
    void load(filterRef.current, "merge");
  };

  const open = async (event: React.MouseEvent<HTMLAnchorElement>, item: NotificationItem) => {
    const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;
    if (modified) {
      // New tab / window: let the browser do it; just record the read.
      void markNotificationRead(item.id).then(() => ctx.refresh());
      markLocalRead(item.id);
      return;
    }
    event.preventDefault();
    markLocalRead(item.id);
    const result = await openNotification(item.id);
    if (!result.ok) {
      setNotice(result.signedOut ? "Your session has ended. Sign in again." : "That notification isn’t available anymore.");
      void load(filterRef.current, "merge");
      return;
    }
    if (!result.available || !result.href) {
      setNotice("That update is no longer available.");
      void load(filterRef.current, "merge");
      return;
    }
    onNavigate?.();
    router.push(result.href);
    void ctx.refresh();
  };

  const groups = groupByDay(items, now, zone);
  const hasUnread = ctx.unread > 0;

  return (
    <div className={cn("flex min-h-0 flex-col", variant === "popover" && "max-h-[inherit]")}>
      <div className={cn("flex flex-wrap items-center justify-between gap-2", variant === "popover" ? "border-b border-border/70 p-3" : "pb-3")}>
        <div role="group" aria-label="Filter notifications" className="inline-flex rounded-xl bg-secondary p-1">
          {(["all", "unread"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => changeFilter(value)}
              className={cn(
                "focus-ring min-h-10 rounded-lg px-4 text-sm font-semibold transition-colors",
                filter === value ? "bg-white text-ink shadow-sm" : "text-muted-foreground hover:text-ink",
              )}
            >
              {value === "all" ? "All" : `Unread${hasUnread ? ` (${ctx.unread > 99 ? "99+" : ctx.unread})` : ""}`}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={markAll}
          disabled={!hasUnread || busyAll || items.length === 0}
          className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-moss-ink hover:bg-moss-soft disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
        >
          {busyAll ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <CheckCheck className="size-4" aria-hidden="true" />}
          Mark all as read
        </button>
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {note || ctx.announcement}
      </p>
      {notice ? (
        <p role="alert" className="mx-3 mt-2 flex items-start gap-2 rounded-xl border border-gold/60 bg-gold-soft/60 p-3 text-sm text-ink">
          <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="focus-ring -my-1 min-h-9 rounded-lg px-2 text-sm font-semibold">
            Dismiss
          </button>
        </p>
      ) : null}

      <div className={cn("min-h-0", variant === "popover" && "flex-1 overflow-y-auto overscroll-contain")} aria-busy={status === "loading"}>
        {status === "loading" && items.length === 0 ? (
          <div className="space-y-3 p-3" aria-label="Loading notifications">
            {[0, 1, 2].map((n) => (
              <div key={n} className="h-16 animate-pulse rounded-xl bg-secondary/70" />
            ))}
          </div>
        ) : status === "error" && items.length === 0 ? (
          <div className="p-6 text-center">
            <p className="font-semibold text-ink">We couldn’t load your notifications.</p>
            <p className="mt-1 text-sm text-muted-foreground">Check your connection, then try again.</p>
            <button
              type="button"
              onClick={() => void load(filter, "replace")}
              className="focus-ring mt-4 min-h-11 rounded-xl border border-input bg-white px-5 text-sm font-semibold text-ink hover:bg-secondary"
            >
              Try again
            </button>
          </div>
        ) : items.length === 0 ? (
          <Empty variant={variant} filter={filter} onShowAll={() => changeFilter("all")} />
        ) : (
          <div className={cn(variant === "popover" && "pb-2")}>
            {groups.map((group) => (
              <section key={group.label} aria-labelledby={`notif-group-${variant}-${group.label}`}>
                <h3
                  id={`notif-group-${variant}-${group.label}`}
                  className="eyebrow px-3 pt-4 pb-1.5 text-muted-foreground"
                >
                  {group.label}
                </h3>
                <ul className="space-y-1.5 px-1.5">
                  {group.items.map((item) => (
                    <Row
                      key={item.id}
                      item={item}
                      now={now}
                      zone={zone}
                      onOpen={open}
                      onMarkRead={() => void markOne(item)}
                      onActed={() => {
                        void ctx.refresh();
                        void load(filterRef.current, "merge");
                      }}
                    />
                  ))}
                </ul>
              </section>
            ))}
            {nextCursor ? (
              <div className="flex justify-center p-3">
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-xl border border-input bg-white px-5 text-sm font-semibold text-ink hover:bg-secondary disabled:opacity-60"
                >
                  {loadingMore ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                  {loadingMore ? "Loading…" : "Show earlier"}
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {variant === "popover" ? (
        <div className="border-t border-border/70 p-2">
          <Link
            href="/notifications"
            onClick={onNavigate}
            className="focus-ring flex min-h-11 items-center justify-center rounded-xl text-sm font-semibold text-moss-ink hover:bg-moss-soft"
          >
            Open the full inbox
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function Empty({ variant, filter, onShowAll }: { variant: Props["variant"]; filter: NotificationFilter; onShowAll: () => void }) {
  const unread = filter === "unread";
  const title = unread ? "Nothing unread" : "You’re all caught up";
  const description = unread
    ? "Every notification has been read. Older ones are still under All."
    : "Trip invitations, changes your travel group makes to the plan, and reminders will show up here.";
  if (variant === "page") {
    return (
      <MascotEmptyState
        tone="quiet"
        headingLevel={2}
        title={title}
        description={description}
        actionLabel={unread ? "Show all notifications" : undefined}
        onAction={unread ? onShowAll : undefined}
      />
    );
  }
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-moss-soft text-moss-ink">
        <Bell className="size-6" aria-hidden="true" />
      </span>
      <p className="mt-3 font-display text-lg font-semibold text-ink">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      {unread ? (
        <button
          type="button"
          onClick={onShowAll}
          className="focus-ring mt-4 min-h-11 rounded-xl border border-input bg-white px-5 text-sm font-semibold text-ink hover:bg-secondary"
        >
          Show all
        </button>
      ) : null}
    </div>
  );
}

function Row({
  item,
  now,
  zone,
  onOpen,
  onMarkRead,
  onActed,
}: {
  item: NotificationItem;
  now: Date;
  zone: string;
  onOpen: (event: React.MouseEvent<HTMLAnchorElement>, item: NotificationItem) => void;
  onMarkRead: () => void;
  onActed: () => void;
}) {
  const Icon = ICONS[item.type];
  const unread = item.available && !item.read_at;
  const meta = [item.trip?.title, timeLabel(item.created_at, now, zone)].filter(Boolean).join(" · ");
  const content = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-full",
          item.available ? (unread ? "bg-moss-soft text-moss-ink" : "bg-secondary text-muted-foreground") : "bg-secondary text-muted-foreground",
        )}
      >
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className={cn("block truncate text-[0.9375rem]", unread ? "font-semibold text-ink" : "font-medium text-ink/80")}>
            {item.title}
          </span>
          {unread ? (
            <>
              <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-gold" />
              <span className="sr-only">Unread</span>
            </>
          ) : null}
        </span>
        <span className={cn("mt-0.5 block text-sm break-words", item.available ? "text-ink/80" : "text-muted-foreground")}>
          {item.body}
        </span>
        {meta ? <span className="mt-1 block truncate text-xs text-muted-foreground">{meta}</span> : null}
      </span>
    </>
  );
  const shell = cn(
    "flex min-w-0 flex-1 items-start gap-3 rounded-xl p-3 text-left",
    unread ? "bg-gold-soft/40" : "bg-transparent",
  );
  return (
    <li className="rounded-xl hover:bg-secondary/60">
      <div className="flex items-stretch gap-1">
        {item.available && item.href ? (
          <a href={item.href} onClick={(event) => onOpen(event, item)} className={cn(shell, "focus-ring")}>
            {content}
          </a>
        ) : (
          <div className={shell}>{content}</div>
        )}
        {unread ? (
          <button
            type="button"
            onClick={onMarkRead}
            aria-label={`Mark as read: ${item.title}`}
            className="focus-ring grid min-h-11 w-11 shrink-0 place-items-center self-center rounded-xl text-muted-foreground hover:bg-moss-soft hover:text-moss-ink"
          >
            <CheckCheck className="size-5" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {item.reminder ? <ReminderActions item={item} onActed={onActed} /> : null}
    </li>
  );
}
