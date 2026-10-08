"use client";

import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertCircle, Check, Eye, ImageOff, Loader2 } from "lucide-react";
import { useAppearance } from "@/components/settings/settings-provider";
import { BACKGROUND_REGISTRY } from "@/lib/backgrounds";
import { cn } from "@/lib/utils";

const primary =
  "focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-moss-ink px-4 text-sm font-semibold text-white hover:bg-moss-hover disabled:cursor-not-allowed disabled:opacity-60";
const quiet =
  "focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-input bg-white px-4 text-sm font-semibold text-ink hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60";

/**
 * The one global appearance bar, directly under the header on every signed-in
 * page. While a preview is unsaved it carries the only Save / Cancel; it also
 * shows the short "Saved" confirmation and a background that could not load.
 * It is sticky in the page flow (never over content) and publishes its height
 * as --atlas-bar-h so the other sticky offsets and scroll-padding clear it.
 */
export function AppearanceBar() {
  const a = useAppearance();
  const pathname = usePathname();
  const onSettings = pathname === "/settings";

  const showSaved = !a.previewing && a.phase === "saved";
  const visible = a.previewing || showSaved || a.imageError !== null;

  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!visible || !el) return;
    const publish = () => root.style.setProperty("--atlas-bar-h", `${el.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--atlas-bar-h");
    };
  }, [visible]);

  if (!visible) return null;

  const name = BACKGROUND_REGISTRY[a.effective.background].label;
  const remoteName = a.remote ? BACKGROUND_REGISTRY[a.remote.background].label : null;
  const saving = a.phase === "saving";
  const failedName = a.imageError ? BACKGROUND_REGISTRY[a.imageError].label : null;

  let body: ReactNode;
  if (a.previewing) {
    body = (
      <>
        <div className="min-w-0 flex-1 space-y-1 text-sm text-ink">
          <p role="status" className="flex items-start gap-2 font-semibold">
            <Eye className="mt-0.5 size-4 shrink-0 text-moss-ink" aria-hidden="true" />
            <span className="min-w-0">
              Previewing — save to keep this appearance. <span className="font-normal text-muted-foreground">{name}</span>
              {!onSettings ? (
                <>
                  {" "}
                  <Link href="/settings?section=appearance" className="focus-ring rounded font-semibold text-moss-ink underline underline-offset-2">
                    Appearance settings
                  </Link>
                </>
              ) : null}
            </span>
          </p>
          {a.phase === "error" || a.phase === "conflict" ? (
            <p role="alert" className="flex items-start gap-2 text-[#8c2b1f]">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0">{a.message}</span>
            </p>
          ) : null}
          {a.remote && a.phase !== "conflict" ? (
            <p className="text-muted-foreground">
              Another device saved a newer appearance ({remoteName}). Your preview is unchanged; saving will replace it.
            </p>
          ) : null}
          {a.phase === "conflict" && remoteName ? <p className="text-muted-foreground">The other device chose {remoteName}.</p> : null}
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" className={quiet} onClick={a.cancel} disabled={saving}>
            {a.remote ? "Use theirs" : "Cancel"}
          </button>
          <button type="button" className={primary} onClick={() => void a.save()} disabled={saving} aria-busy={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            {saving ? "Saving…" : a.phase === "error" ? "Try again" : a.remote ? "Save mine instead" : "Save"}
          </button>
        </div>
      </>
    );
  } else if (showSaved) {
    body = (
      <p role="status" className="flex items-center gap-2 text-sm font-semibold text-moss-ink">
        <Check className="size-4" aria-hidden="true" />
        Appearance saved.
      </p>
    );
  } else {
    body = null;
  }

  return (
    <div
      ref={ref}
      data-appearance-bar=""
      className={cn(
        "sticky top-16 z-30 border-b bg-surface shadow-sm print:hidden",
        a.previewing ? "border-gold/70" : "border-border",
      )}
    >
      <div className="mx-auto flex max-w-[1280px] flex-col gap-2 px-4 py-2.5 sm:px-6 lg:px-8">
        {body ? <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-4">{body}</div> : null}
        {a.imageError ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-ink">
            <p role="status" className="flex min-w-0 flex-1 items-start gap-2">
              <ImageOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0">
                {failedName} couldn’t load, so Atlas is showing Plain Ivory.
                {a.previewing ? "" : " Your saved choice hasn’t changed."}
              </span>
            </p>
            <button type="button" className={quiet} onClick={a.retryImage}>
              Try again
            </button>
            {!a.previewing ? (
              <button type="button" className={quiet} onClick={a.dismissImageError}>
                Dismiss
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
