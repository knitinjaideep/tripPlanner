import Link from "next/link";

export default function TripNotFound() {
  return (
    <main className="mx-auto max-w-xl px-4 py-20 text-center">
      <p className="eyebrow text-teal-ink">Trip not found</p>
      <h1 className="font-display mt-3 text-4xl font-semibold text-ink">This trip isn’t here</h1>
      <p className="mt-3 text-muted-foreground">
        It may have been deleted, or the link belongs to a different account.
      </p>
      <Link
        href="/trips"
        className="focus-ring mt-8 inline-flex min-h-11 items-center rounded-xl bg-coral px-5 font-semibold text-white hover:bg-coral-hover"
      >
        Back to my trips
      </Link>
    </main>
  );
}
