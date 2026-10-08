import type { Metadata } from "next";
import { connection } from "next/server";
import { SetupNotice } from "@/components/setup-notice";
import { getInvitePageByIdForUser } from "@/lib/dal";
import { missingConfig } from "@/lib/env";
import { InviteView } from "@/app/invite/[token]/invite-view";

export const metadata: Metadata = {
  title: "Trip invitation",
  robots: { index: false, follow: false },
};

/**
 * An invitation opened from the notification inbox. Signed-in only (the proxy
 * sends everyone else through sign-in and back here), addressed by invitation
 * id — the raw token never appears. Opening it never accepts anything.
 */
export default async function InvitationPage({ params }: PageProps<"/invitations/[invitationId]">) {
  await connection();
  const missing = missingConfig();
  if (missing.length > 0) return <SetupNotice missing={missing} />;
  const { invitationId } = await params;
  return <InviteView view={await getInvitePageByIdForUser(invitationId)} target={{ invitationId }} />;
}
