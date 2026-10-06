import { MascotEmptyState } from "@/components/mascot";

export default function TripNotFound() {
  return (
    <main className="mx-auto max-w-xl px-4 py-16 sm:py-20">
      <MascotEmptyState
        headingLevel={2}
        title="This trip isn’t here"
        description="It may have been deleted, or the link belongs to a different account."
        actionLabel="Back to my trips"
        actionHref="/trips"
      />
    </main>
  );
}
