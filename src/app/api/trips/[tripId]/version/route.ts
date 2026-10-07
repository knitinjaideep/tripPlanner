import { NextResponse } from "next/server";
import { AuthRequiredError, getTripVersionForUser } from "@/lib/dal";
import { SessionUnavailableError } from "@/lib/user";

/**
 * Change fingerprint for one trip, polled by open tabs so other members'
 * edits show up without a reload. Authorized per request like every other
 * read: signed out → 401, no access (including a removed member) → 404.
 * The body is an opaque hash — no trip content.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await ctx.params;
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const version = await getTripVersionForUser(tripId);
    if (version === null) return NextResponse.json({ error: "not_found" }, { status: 404, headers });
    return NextResponse.json({ version }, { headers });
  } catch (error) {
    if (error instanceof AuthRequiredError) return NextResponse.json({ error: "signed_out" }, { status: 401, headers });
    if (error instanceof SessionUnavailableError) return NextResponse.json({ error: "unavailable" }, { status: 503, headers });
    console.error("[rove] trip version check failed:", (error as Error)?.name);
    return NextResponse.json({ error: "failed" }, { status: 500, headers });
  }
}
