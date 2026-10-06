import { Skeleton } from "@/components/ui/skeleton";

export default function MemoriesLoading() {
  return (
    <div aria-busy="true" className="space-y-10">
      <span className="sr-only">Loading memories…</span>
      <Skeleton className="h-60 rounded-2xl bg-border/50" />
      <div className="grid gap-5 lg:grid-cols-12">
        <Skeleton className="h-56 rounded-2xl bg-border/50 lg:col-span-8" />
        <Skeleton className="h-56 rounded-2xl bg-border/50 lg:col-span-4" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-8 w-40 bg-border/70" />
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-32 rounded-2xl bg-border/50" />
        ))}
      </div>
    </div>
  );
}
