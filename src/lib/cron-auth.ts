import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

export const cronHeaders = { "Cache-Control": "private, no-store" };
const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * Authenticates a scheduler's call with the server secret in the
 * Authorization header (`Authorization: Bearer $CRON_SECRET` — exactly what
 * Vercel Cron sends when a CRON_SECRET environment variable exists). With no
 * secret configured (or a short one) every request is refused, so a fresh
 * deployment can never be triggered by strangers. Returns a response to send
 * back, or null when the caller is authorized.
 */
export function rejectUnlessCron(request: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.length < 16) return NextResponse.json({ error: "not_configured" }, { status: 503, headers: cronHeaders });
  const given = request.headers.get("authorization") ?? "";
  if (!timingSafeEqual(digest(given), digest(`Bearer ${secret}`))) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: cronHeaders });
  return null;
}
