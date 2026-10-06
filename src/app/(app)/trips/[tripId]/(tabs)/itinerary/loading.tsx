import { Skeleton } from "@/components/ui/skeleton";

export default function ItineraryLoading() {
  return (
    <div aria-busy="true" className="grid gap-8 lg:grid-cols-12">
      <span className="sr-only">Loading itinerary…</span>
      <div className="min-w-0 space-y-6 lg:col-span-8">
        <div className="flex gap-2 overflow-hidden">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-[5.5rem] w-[4.25rem] shrink-0 rounded-2xl bg-border/60" />
          ))}
        </div>
        <div className="flex items-end justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-3 w-24 bg-border/70" />
            <Skeleton className="h-8 w-64 bg-border/70" />
          </div>
          <Skeleton className="h-11 w-36 rounded-xl bg-border/60" />
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="grid sm:grid-cols-[5rem_1fr] sm:gap-3">
            <Skeleton className="mt-4 ml-auto hidden h-4 w-14 bg-border/60 sm:block" />
            <Skeleton className="h-24 rounded-2xl bg-border/50" />
          </div>
        ))}
      </div>
      <div className="lg:col-span-4">
        <Skeleton className="h-64 rounded-2xl bg-border/50" />
      </div>
    </div>
  );
}
