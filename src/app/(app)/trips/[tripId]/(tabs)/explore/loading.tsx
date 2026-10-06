import { Skeleton } from "@/components/ui/skeleton";

export default function ExploreLoading() {
  return (
    <div aria-busy="true" className="space-y-6">
      <span className="sr-only">Loading places…</span>
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40 bg-border/70" />
          <Skeleton className="h-4 w-64 bg-border/60" />
        </div>
        <Skeleton className="h-11 w-32 rounded-xl bg-border/60" />
      </div>
      <Skeleton className="h-12 rounded-xl bg-border/50" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-40 rounded-2xl bg-border/50" />
        ))}
      </div>
    </div>
  );
}
