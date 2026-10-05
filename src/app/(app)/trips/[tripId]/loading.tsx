import { Skeleton } from "@/components/ui/skeleton";

export default function TripLoading() {
  return (
    <div aria-busy="true">
      <span className="sr-only">Loading trip…</span>
      <Skeleton className="h-[15rem] w-full rounded-none bg-border/60 sm:h-[19rem]" />
      <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8">
        <div className="flex gap-6 border-b border-border py-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-5 w-20 bg-border/70" />
          ))}
        </div>
        <div className="grid gap-5 pt-8 md:grid-cols-2 lg:grid-cols-12">
          <Skeleton className="h-72 rounded-2xl bg-border/50 lg:col-span-5" />
          <Skeleton className="h-72 rounded-2xl bg-border/50 lg:col-span-4" />
          <Skeleton className="h-72 rounded-2xl bg-border/50 md:col-span-2 lg:col-span-3" />
        </div>
      </div>
    </div>
  );
}
