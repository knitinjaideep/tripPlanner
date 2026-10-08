/**
 * Operator dry run: print the evening preview one person would get for one
 * trip and date, from the CURRENT saved data. Read-only — it writes nothing,
 * sends nothing, and needs database credentials, so it is not something an
 * ordinary user can run for someone else.
 *
 *   npm run evening:dry-run -- --trip <trip-uuid> --user <user-id> --date 2026-10-15 [--now 2026-10-14T23:05:00Z]
 *
 * `--date` is the day being previewed ("tomorrow"). `--now` only affects the
 * "As of …" line and the poll-deadline checks. Reads DATABASE_URL (or
 * TEST_DATABASE_URL) from the environment / .env.local.
 */
import { loadEnvConfig } from "@next/env";
import { createDb } from "../src/db";
import { buildPreview } from "../src/db/evening-preview";
import { buildPreviewEmail } from "../src/lib/email/evening-email";

loadEnvConfig(process.cwd());
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  const [trip, user, date] = [arg("trip"), arg("user"), arg("date")];
  if (!url || !trip || !user || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("Usage: npm run evening:dry-run -- --trip <uuid> --user <user-id> --date YYYY-MM-DD [--now ISO]");
    process.exit(2);
  }
  const { db, pool } = createDb(url);
  try {
    const now = arg("now") ? new Date(arg("now")!) : new Date();
    const preview = await buildPreview(db, trip, user, date, now);
    if (!preview) {
      console.log("No preview: that person has no access to that trip.");
      return;
    }
    console.log("DRY RUN — nothing was written or sent.\n");
    console.log(`Title:  ${preview.title}`);
    console.log(`Body:   ${preview.body}`);
    console.log(`Action: ${preview.poll ? "Vote & view tomorrow" : "View tomorrow"} → ${preview.href}`);
    console.log(`Poll:   ${preview.poll ? `${preview.poll.question} (${preview.poll.reason})` : "none"}`);
    console.log("\nEmail text:\n" + buildPreviewEmail(preview, trip, "https://app.example").text);
  } finally {
    await pool.end();
  }
}
main().catch((e) => {
  console.error("Failed:", (e as Error).message);
  process.exitCode = 1;
});
