import type { Metadata } from "next";
import { connection } from "next/server";
import { SetupNotice } from "@/components/setup-notice";
import { getInvitePageForUser } from "@/lib/dal";
import { missingConfig } from "@/lib/env";
import { InviteView } from "./invite-view";

// The page's URL holds a secret: keep it out of search results and referrers (headers are set in next.config.ts too).
export const metadata: Metadata = {
  title: "Trip invitation",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  await connection();
  const missing = missingConfig();
  if (missing.length > 0) return <SetupNotice missing={missing} />;
  const { token } = await params;
  return <InviteView view={await getInvitePageForUser(token)} target={{ token }} />;
}
