import { Settings2 } from "lucide-react";
import { Logo } from "@/components/brand";
import { MascotImage } from "@/components/mascot";

/** Shown instead of the app when required server settings are missing. */
export function SetupNotice({ missing }: { missing: string[] }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-4 py-16">
      <Logo href="/login" />
      <div className="card-surface mt-8 p-6 sm:p-8">
        <MascotImage size="sm" decorative className="mb-4" />
        <p className="eyebrow flex items-center gap-2 text-moss-ink">
          <Settings2 className="size-4" aria-hidden="true" /> Setup needed
        </p>
        <h1 className="font-display mt-3 text-3xl font-semibold text-ink">Connect Atlas to Neon</h1>
        <p className="mt-3 text-muted-foreground">
          Add these to <code className="font-mono text-ink">.env.local</code>, apply the database migrations, then
          restart the dev server:
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
          {missing.map((name) => (
            <li key={name}>
              <code className="font-mono text-ink">{name}</code>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-muted-foreground">
          Step-by-step instructions are in <code className="font-mono text-ink">docs/local-setup.md</code>.
        </p>
      </div>
    </main>
  );
}
