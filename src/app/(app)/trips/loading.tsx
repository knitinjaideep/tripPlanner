import { Skeleton } from "@/components/ui/skeleton";

export default function TripsLoading() {
  return (
    <main className="mx-auto max-w-[1280px] px-4 pt-8 pb-16 sm:px-6 sm:pt-12 lg:px-8" aria-busy="true">
      <span className="sr-only">Loading your trips…</span>
      <Skeleton className="h-3 w-20 bg-border/70" />
      <Skeleton className="mt-4 h-12 w-80 max-w-full bg-border/70" />
      <Skeleton className="mt-4 h-5 w-56 bg-border/70" />
      <div className="mt-12 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="card-surface overflow-hidden">
            <Skeleton className="aspect-[16/10] rounded-none bg-border/60" />
            <div className="space-y-3 p-5">
              <Skeleton className="h-3 w-24 bg-border/70" />
              <Skeleton className="h-7 w-3/4 bg-border/70" />
              <Skeleton className="h-4 w-1/2 bg-border/70" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
