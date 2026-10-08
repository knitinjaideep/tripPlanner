export default function Loading() {
  return (
    <div className="space-y-4 py-6" aria-busy="true" aria-label="Loading questions">
      <div className="h-9 w-56 animate-pulse rounded-lg bg-secondary/70" />
      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1].map((n) => (
          <div key={n} className="h-56 animate-pulse rounded-2xl bg-secondary/60" />
        ))}
      </div>
    </div>
  );
}
