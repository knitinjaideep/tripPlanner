import type { ComponentPropsWithoutRef, ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";
import mascot from "../../public/brand/atlas-mascot.png";

/**
 * atlas's brand character: the smiling earth guardian (public/brand/atlas-mascot.png).
 * A warm accent, used once per screen at most — hero, onboarding, empty,
 * loading and "not found" states. Square artwork on a transparent ground;
 * always rendered square so it never distorts.
 */

export const MASCOT_ALT = "Atlas smiling earth guardian mascot";

const SIZES = {
  xs: { box: "size-12", sizes: "48px" },
  sm: { box: "size-20", sizes: "80px" },
  md: { box: "size-32", sizes: "128px" },
  greet: { box: "size-20 sm:size-28 lg:size-32", sizes: "(min-width: 1024px) 128px, (min-width: 640px) 112px, 80px" },
  lg: { box: "size-44 sm:size-52", sizes: "(min-width: 640px) 208px, 176px" },
  hero: { box: "size-40 sm:size-64 lg:size-[22rem]", sizes: "(min-width: 1024px) 352px, (min-width: 640px) 256px, 160px" },
} as const;

export type MascotSize = keyof typeof SIZES;

export function MascotImage({
  size = "md",
  variant = "plain",
  alt = MASCOT_ALT,
  decorative = false,
  priority = false,
  className,
}: {
  size?: MascotSize;
  /** "glow" adds a soft golden halo behind the character (hero and loading use). */
  variant?: "plain" | "glow";
  alt?: string;
  /** Next to a heading that already says it all: hide from screen readers. */
  decorative?: boolean;
  priority?: boolean;
  className?: string;
}) {
  const s = SIZES[size];
  return (
    <span className={cn("relative inline-grid shrink-0 place-items-center", s.box, className)}>
      {variant === "glow" ? (
        <span
          aria-hidden="true"
          className="absolute inset-[-12%] rounded-full bg-[radial-gradient(closest-side,rgb(255_231_163/0.85),rgb(245_196_81/0.28)_55%,transparent_75%)] blur-md motion-safe:animate-mascot-glow"
        />
      ) : null}
      <Image
        src={mascot}
        alt={decorative ? "" : alt}
        sizes={s.sizes}
        priority={priority}
        placeholder={size === "hero" || size === "lg" ? "blur" : "empty"}
        className={cn(
          "relative size-full object-contain drop-shadow-[0_10px_18px_rgba(24,58,47,0.16)]",
          variant === "glow" && "motion-safe:animate-mascot-breathe",
        )}
      />
    </span>
  );
}

/** Ivory/white card with a soft green border and a gentle golden glow. */
export function BrandGlowCard({ className, children, ...props }: ComponentPropsWithoutRef<"div">) {
  return (
    <div className={cn("brand-glow-card", className)} {...props}>
      {children}
    </div>
  );
}

const primaryAction =
  "focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-moss-ink px-5 text-[0.9375rem] font-semibold text-white shadow-[0_6px_16px_-8px_rgba(62,122,58,0.55)] transition-colors hover:bg-moss-hover";

/**
 * Small mascot + title + description + optional action, in a calm card.
 * Use `action` for a custom button (e.g. one that opens a sheet), or
 * `actionLabel` with `actionHref` / `onAction` (onAction only from Client
 * Components).
 */
export function MascotEmptyState({
  title,
  description,
  action,
  actionLabel,
  actionHref,
  onAction,
  tone = "card",
  headingLevel = 3,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
  /** "card": white card. "quiet": dashed outline, for "no results" inside a page. */
  tone?: "card" | "quiet";
  headingLevel?: 2 | 3;
  className?: string;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const button = action ?? (actionLabel && actionHref ? (
    <Link href={actionHref} className={primaryAction}>
      {actionLabel}
    </Link>
  ) : actionLabel && onAction ? (
    <button type="button" onClick={onAction} className={primaryAction}>
      {actionLabel}
    </button>
  ) : null);

  return (
    <div
      className={cn(
        "flex flex-col items-center px-6 text-center",
        tone === "card" ? "card-surface py-10 sm:py-12" : "rounded-2xl border border-dashed border-input bg-surface/60 py-8",
        className,
      )}
    >
      <MascotImage size={tone === "card" ? "md" : "sm"} decorative />
      <Heading className={cn("font-display font-semibold text-ink", tone === "card" ? "mt-4 text-2xl" : "mt-3 text-xl")}>
        {title}
      </Heading>
      {description ? <p className="mx-auto mt-2 max-w-md text-muted-foreground">{description}</p> : null}
      {button ? <div className="mt-6">{button}</div> : null}
    </div>
  );
}

/** Mascot with a slow golden pulse ring, for loading and syncing moments. */
export function MascotLoader({
  message = "Gathering your trips…",
  size = "sm",
  className,
}: {
  message?: string;
  size?: Extract<MascotSize, "xs" | "sm" | "md">;
  className?: string;
}) {
  return (
    <div role="status" aria-live="polite" className={cn("flex items-center gap-4", className)}>
      <span className="relative isolate grid place-items-center">
        <span
          aria-hidden="true"
          className="absolute inset-0 -z-10 rounded-full border-2 border-gold/70 motion-safe:animate-mascot-ring"
        />
        <MascotImage size={size} variant="glow" decorative />
      </span>
      <span className="font-display text-lg font-semibold text-ink">{message}</span>
    </div>
  );
}
