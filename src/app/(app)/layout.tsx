import { connection } from "next/server";
import { SiteHeader } from "@/components/site-header";
import { SetupNotice } from "@/components/setup-notice";
import { missingConfig } from "@/lib/env";
import { requireUser } from "@/lib/dal";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  // Always per-request: auth and env are runtime concerns, never prerendered.
  await connection();
  const missing = missingConfig();
  if (missing.length > 0) return <SetupNotice missing={missing} />;
  // For the header only. Every page and action re-verifies through the DAL.
  const user = await requireUser();

  return (
    <>
      <SiteHeader user={user} />
      <div className="min-w-0 flex-1">{children}</div>
    </>
  );
}
