import Link from "next/link";
import { Plus } from "lucide-react";

export function NewTripButton({ label = "New trip" }: { label?: string }) {
  return (
    <Link
      href="/trips/new"
      className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-coral px-5 text-[0.9375rem] font-semibold text-white shadow-[0_6px_16px_-8px_rgba(204,69,51,0.7)] transition-colors hover:bg-coral-hover"
    >
      <Plus className="size-4" aria-hidden="true" />
      {label}
    </Link>
  );
}
