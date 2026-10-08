import { NextResponse, type NextRequest } from "next/server";
import { cronHeaders as headers, rejectUnlessCron } from "@/lib/cron-auth";
import { runReminderJob } from "@/lib/dal";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The reminder scheduler's trigger. Not a user route: it has no session and is
 * authenticated by the server secret (see `rejectUnlessCron`).
 *
 * - `GET|POST /api/cron/reminders` runs one idempotent pass (see
 *   `runReminders`): expire what is past its freshness window, claim what is
 *   due, deliver, then email. Run it every few minutes (5 recommended); extra
 *   or overlapping calls are safe. The reply holds counts only.
 * - `?dryRun=1` lists what WOULD be delivered right now — it writes nothing and
 *   sends nothing — and may pretend the time is `at=<ISO instant>`.
 */
async function handle(request: NextRequest) {
  const refused = rejectUnlessCron(request);
  if (refused) return refused;

  const params = request.nextUrl.searchParams;
  const dryRun = params.get("dryRun") === "1";
  let now: Date | undefined;
  if (dryRun && params.get("at")) {
    now = new Date(params.get("at")!);
    if (Number.isNaN(now.getTime())) return NextResponse.json({ error: "bad_at" }, { status: 400, headers });
  }
  try {
    const report = await runReminderJob({ dryRun, now });
    return NextResponse.json(dryRun ? report : { ...report, due: [] }, { headers });
  } catch (error) {
    console.error("[rove] reminder job failed:", (error as Error)?.name);
    return NextResponse.json({ error: "failed" }, { status: 500, headers });
  }
}

export const GET = handle;
export const POST = handle;
