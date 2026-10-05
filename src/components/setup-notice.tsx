import { Settings2 } from "lucide-react";
import { Logo } from "@/components/brand";

/** Shown instead of the app when Supabase environment variables are missing. */
export function SetupNotice() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-4 py-16">
      <Logo href="/login" />
      <div className="card-surface mt-8 p-6 sm:p-8">
        <p className="eyebrow flex items-center gap-2 text-teal-ink">
          <Settings2 className="size-4" aria-hidden="true" /> Setup needed
        </p>
        <h1 className="font-display mt-3 text-3xl font-semibold text-ink">Connect rove to Supabase</h1>
        <p className="mt-3 text-muted-foreground">
          Add <code className="font-mono text-ink">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code className="font-mono text-ink">NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> to{" "}
          <code className="font-mono text-ink">.env.local</code>, apply the database migration, enable Google
          sign-in, then restart the dev server. Step-by-step instructions are in{" "}
          <code className="font-mono text-ink">docs/setup.md</code>.
        </p>
      </div>
    </main>
  );
}
