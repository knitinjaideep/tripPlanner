import Link from "next/link";
import { Logo } from "@/components/brand";
import { MascotImage } from "@/components/mascot";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center px-4 text-center">
      <Logo />
      <MascotImage size="md" variant="glow" decorative className="mt-10" />
      <h1 className="font-display mt-6 text-4xl font-semibold text-ink">Off the map</h1>
      <p className="mt-3 text-muted-foreground">We couldn’t find that page — but your trips are right where you left them.</p>
      <Link
        href="/trips"
        className="focus-ring mt-8 inline-flex min-h-11 items-center rounded-xl bg-moss-ink px-5 font-semibold text-white hover:bg-moss-hover"
      >
        Go to my trips
      </Link>
    </main>
  );
}
