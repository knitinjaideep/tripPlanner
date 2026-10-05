import Link from "next/link";
import { Logo } from "@/components/brand";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center px-4 text-center">
      <Logo />
      <h1 className="font-display mt-10 text-4xl font-semibold text-ink">Off the map</h1>
      <p className="mt-3 text-muted-foreground">We couldn’t find that page.</p>
      <Link
        href="/trips"
        className="focus-ring mt-8 inline-flex min-h-11 items-center rounded-xl bg-coral px-5 font-semibold text-white hover:bg-coral-hover"
      >
        Go to my trips
      </Link>
    </main>
  );
}
