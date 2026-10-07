import { NextResponse, type NextRequest } from "next/server";
import { INVITE_COOKIE, TOKEN_PATTERN, invitePath } from "@/lib/sharing";

/**
 * Where sign-in returns when someone arrived on an invitation link while signed
 * out. The token waited in a short-lived first-party cookie (it never went
 * through the sign-in provider); here it is moved back into the invitation URL
 * and the cookie is deleted. Signing in does NOT accept anything — the invitation
 * page still needs an explicit "Accept invitation".
 */
export async function GET(request: NextRequest) {
  const token = request.cookies.get(INVITE_COOKIE)?.value ?? "";
  const target = TOKEN_PATTERN.test(token) ? invitePath(token) : "/trips";
  const response = NextResponse.redirect(new URL(target, request.url), 303);
  response.cookies.delete(INVITE_COOKIE);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
