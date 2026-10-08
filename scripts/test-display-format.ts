/**
 * Display preferences are presentation only: the clock, distance and money
 * formatters, and the guarantee that they never change what is stored.
 * No database. Also run with TZ=Pacific/Kiritimati and TZ=Pacific/Pago_Pago.
 *
 *   npm run test:display-format
 */
import assert from "node:assert/strict";
import { formatMoney, formatClockTime, formatDistance, METERS_PER_MILE } from "../src/lib/display-format";
import { formatTime } from "../src/lib/dates";
import { formatMoment, formatZonedTime } from "../src/lib/booking-format";
import { backgroundFiles, backgroundThumbUrl, backgroundUrl, BACKGROUND_IDS, BACKGROUND_REGISTRY, notificationGroupOf } from "../src/lib/settings";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log(`Time zone of this process: ${process.env.TZ ?? "system"}`);
check("12-hour is the default and unchanged", () => {
  assert.equal(formatTime("08:20:00"), "8:20 AM");
  assert.equal(formatTime("00:05"), "12:05 AM");
  assert.equal(formatTime("12:00"), "12:00 PM");
  assert.equal(formatTime("23:59:00"), "11:59 PM");
});
check("24-hour is the same wall-clock time, written differently", () => {
  assert.equal(formatClockTime("08:20:00", "24h"), "08:20");
  assert.equal(formatClockTime("00:05", "24h"), "00:05");
  assert.equal(formatClockTime("18:30", "24h"), "18:30");
  assert.equal(formatTime("18:30:00", "24h"), "18:30");
});
check("every minute of the day round-trips between the two clocks (no shift, no zone maths)", () => {
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 1, 29, 30, 59]) {
      const t = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      const twelve = formatClockTime(t, "12h");
      const match = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(twelve)!;
      const back = ((Number(match[1]) % 12) + (match[3] === "PM" ? 12 : 0)) * 60 + Number(match[2]);
      assert.equal(back, h * 60 + m);
      assert.equal(formatClockTime(t, "24h"), t);
    }
  }
});
check("zone labels are untouched by the clock choice (a flight keeps its own zone)", () => {
  assert.equal(formatZonedTime("2026-10-14", "08:20", "America/New_York"), "8:20 AM EDT");
  assert.equal(formatMoment("2026-10-14", "08:20", true, "America/New_York"), "Wed, Oct 14 · 8:20 AM EDT");
});
check("distances: converted only from real meters", () => {
  assert.equal(formatDistance(METERS_PER_MILE, "mi"), "1 mi");
  assert.equal(formatDistance(5000, "km"), "5 km");
  assert.equal(formatDistance(5000, "mi"), "3.1 mi");
  assert.equal(formatDistance(16093.44, "mi"), "10 mi");
  assert.equal(formatDistance(0, "km"), "0 km");
  assert.equal(formatDistance(-1, "km"), "");
  assert.equal(formatDistance(Number.NaN, "km"), "");
});
check("money keeps its own currency; there is no conversion API", () => {
  assert.equal(formatMoney(1250, "USD"), "$12.50");
  assert.equal(formatMoney(1250, "usd"), "$12.50");
  assert.match(formatMoney(1250, "EUR"), /€12\.50/);
  assert.equal(formatMoney(1250, "JPY"), "¥1,250", "zero-decimal currencies are not divided by 100");
  assert.equal(formatMoney(1250, "ZZZ0"), "12.50 ZZZ0", "an unknown code is shown as-is, never swapped for another currency");
  assert.equal(formatMoney.length, 2, "amount and its own currency are the only inputs");
});
check("backgrounds: eleven choices, Plain Ivory is CSS-only, the ten others have a picture and a thumbnail", () => {
  assert.equal(BACKGROUND_IDS.length, 11);
  assert.equal(backgroundUrl("plain-ivory"), null);
  assert.deepEqual(backgroundFiles("plain-ivory"), []);
  for (const id of BACKGROUND_IDS.filter((b) => b !== "plain-ivory")) {
    assert.ok(backgroundUrl(id)?.startsWith("/backgrounds/"));
    assert.ok(backgroundThumbUrl(id)?.endsWith("-thumb.webp"));
    assert.equal(backgroundFiles(id).length, 2);
  }
  assert.equal(new Set(BACKGROUND_IDS.map((id) => BACKGROUND_REGISTRY[id].label)).size, 11);
});
check("every notification type belongs to a Settings switch; reminders split by subject", () => {
  assert.equal(notificationGroupOf({ type: "invitation_received" }), "invitations");
  assert.equal(notificationGroupOf({ type: "invitation_accepted" }), "invitations");
  assert.equal(notificationGroupOf({ type: "poll_vote_needed" }), "polls");
  assert.equal(notificationGroupOf({ type: "poll_result" }), "polls");
  assert.equal(notificationGroupOf({ type: "itinerary_changed" }), "shared_changes");
  assert.equal(notificationGroupOf({ type: "evening_preview" }), "evening_preview");
  assert.equal(notificationGroupOf({ type: "reminder", subject: "booking" }), "booking_reminders");
  assert.equal(notificationGroupOf({ type: "reminder", subject: "task" }), "task_reminders");
});

console.log(`\n${passed} checks passed.`);
