import { Skeleton } from "@/components/ui/skeleton";

export default function PackingLoading() {
  return (
    <div aria-busy="true" className="space-y-6">
      <span className="sr-only">Loading packing list…</span>
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-36 bg-border/70" />
          <Skeleton className="h-4 w-60 bg-border/60" />
        </div>
        <Skeleton className="h-11 w-32 rounded-xl bg-border/60" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[13.5rem_minmax(0,1fr)]">
        <div className="hidden space-y-2 lg:block">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-11 rounded-xl bg-border/50" />
          ))}
        </div>
        <div className="space-y-4">
          <Skeleton className="h-12 rounded-xl bg-border/50" />
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-56 rounded-2xl bg-border/50" />
          ))}
        </div>
      </div>
    </div>
  );
}
