import { NextResponse, type NextRequest } from "next/server";
import { AuthRequiredError, listNotificationsForUser } from "@/lib/dal";
import { NOTIFICATION_PAGE_SIZE, type NotificationFilter } from "@/lib/notifications";
import { SessionUnavailableError } from "@/lib/user";

const headers = { "Cache-Control": "private, no-store" };

/**
 * One page of the signed-in person's inbox. The person comes from the
 * verified session, never from the request; `filter` and `cursor` only choose
 * which of THEIR notifications to return. Signed out → 401.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const filter: NotificationFilter = params.get("filter") === "unread" ? "unread" : "all";
  const limit = Math.min(Math.max(Number(params.get("limit")) || NOTIFICATION_PAGE_SIZE, 1), 50);
  try {
    const page = await listNotificationsForUser({ filter, cursor: params.get("cursor"), limit });
    return NextResponse.json(page, { headers });
  } catch (error) {
    if (error instanceof AuthRequiredError) return NextResponse.json({ error: "signed_out" }, { status: 401, headers });
    if (error instanceof SessionUnavailableError) return NextResponse.json({ error: "unavailable" }, { status: 503, headers });
    console.error("[rove] notifications list failed:", (error as Error)?.name);
    return NextResponse.json({ error: "failed" }, { status: 500, headers });
  }
}
