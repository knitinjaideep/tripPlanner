import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export function UserAvatar({
  name,
  initials,
  src,
  className,
}: {
  name: string;
  initials: string;
  src?: string | null;
  className?: string;
}) {
  return (
    <Avatar className={cn("size-10 ring-2 ring-white", className)}>
      {src ? <AvatarImage src={src} alt="" referrerPolicy="no-referrer" /> : null}
      <AvatarFallback className="bg-teal-soft text-sm font-semibold text-teal-ink" aria-label={name}>
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}

const TRAVELER_TINTS = [
  "bg-teal-soft text-teal-ink",
  "bg-sun text-[#7a5a00]",
  "bg-lavender text-lavender-ink",
  "bg-[#ffe4df] text-[#a33a2b]",
];

/** Overlapping initials for trip travelers (names only, no accounts yet). */
export function TravelerStack({ travelers, className }: { travelers: string[]; className?: string }) {
  if (travelers.length === 0) return null;
  const shown = travelers.slice(0, 4);
  return (
    <div className={cn("flex -space-x-2", className)} aria-hidden="true">
      {shown.map((name, i) => (
        <span
          key={`${name}-${i}`}
          className={cn(
            "grid size-8 place-items-center rounded-full text-xs font-semibold ring-2 ring-white",
            TRAVELER_TINTS[i % TRAVELER_TINTS.length],
          )}
        >
          {name.slice(0, 1).toUpperCase()}
        </span>
      ))}
      {travelers.length > shown.length ? (
        <span className="grid size-8 place-items-center rounded-full bg-white text-xs font-semibold text-muted-foreground ring-2 ring-white">
          +{travelers.length - shown.length}
        </span>
      ) : null}
    </div>
  );
}
