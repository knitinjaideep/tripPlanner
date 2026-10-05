import { connection } from "next/server";
import { SiteHeader } from "@/components/site-header";
import { SetupNotice } from "@/components/setup-notice";
import { isSupabaseConfigured } from "@/lib/env";
import { requireUser } from "@/lib/user";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  // Always per-request: auth and env are runtime concerns, never prerendered.
  await connection();
  if (!isSupabaseConfigured()) return <SetupNotice />;
  const user = await requireUser();

  return (
    <>
      <SiteHeader user={user} />
      <div className="min-w-0 flex-1">{children}</div>
    </>
  );
}
