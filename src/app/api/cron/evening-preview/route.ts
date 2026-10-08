import { NextResponse, type NextRequest } from "next/server";
import { rejectUnlessCron, cronHeaders as headers } from "@/lib/cron-auth";
import { runEveningPreviewJob } from "@/lib/dal";
import { idSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const maxDuration = 60;


/**
 * The scheduler's trigger. Not a user route: it has no session and is
 * authenticated by a server secret in the Authorization header
 * (`Authorization: Bearer $CRON_SECRET` — exactly what Vercel Cron sends when
 * a CRON_SECRET environment variable exists). With no secret configured it
 * refuses everything, so a fresh deployment can never be triggered by
 * strangers.
 *
 * - `GET|POST /api/cron/evening-preview` runs one idempotent pass (see
 *   `runEveningPreviews`); the reply holds counts only.
 * - `?dryRun=1` composes what WOULD be sent — writes nothing, sends nothing —
 *   and may narrow with `trip=<uuid>`, `user=<id>` and pretend the time is
 *   `at=<ISO instant>`. It is for the app's operator, behind the same secret.
 */
async function handle(request: NextRequest) {
  const refused = rejectUnlessCron(request);
  if (refused) return refused;

  const params = request.nextUrl.searchParams;
  const dryRun = params.get("dryRun") === "1";
  let now: Date | undefined;
  let only: { tripId?: string; userId?: string } | undefined;
  if (dryRun) {
    const at = params.get("at");
    if (at) {
      now = new Date(at);
      if (Number.isNaN(now.getTime())) return NextResponse.json({ error: "bad_at" }, { status: 400, headers });
    }
    const trip = params.get("trip");
    const user = params.get("user");
    if (trip && !idSchema.safeParse(trip).success) return NextResponse.json({ error: "bad_trip" }, { status: 400, headers });
    if (user && user.length > 255) return NextResponse.json({ error: "bad_user" }, { status: 400, headers });
    only = { tripId: trip ?? undefined, userId: user ?? undefined };
  }
  try {
    const report = await runEveningPreviewJob({ dryRun, now, only });
    return NextResponse.json(dryRun ? report : { ...report, items: [] }, { headers });
  } catch (error) {
    console.error("[rove] evening preview job failed:", (error as Error)?.name);
    return NextResponse.json({ error: "failed" }, { status: 500, headers });
  }
}

export const GET = handle;
export const POST = handle;
