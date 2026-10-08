import { NextResponse } from "next/server";
import { AuthRequiredError, getNotificationSummaryForUser } from "@/lib/dal";
import { SessionUnavailableError } from "@/lib/user";

const headers = { "Cache-Control": "private, no-store" };

/** The bell's poll: unread count plus a marker that changes when something new arrives. Signed out → 401. */
export async function GET() {
  try {
    return NextResponse.json(await getNotificationSummaryForUser(), { headers });
  } catch (error) {
    if (error instanceof AuthRequiredError) return NextResponse.json({ error: "signed_out" }, { status: 401, headers });
    if (error instanceof SessionUnavailableError) return NextResponse.json({ error: "unavailable" }, { status: 503, headers });
    console.error("[rove] notifications summary failed:", (error as Error)?.name);
    return NextResponse.json({ error: "failed" }, { status: 500, headers });
  }
}
