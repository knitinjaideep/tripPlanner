import { NextResponse, type NextRequest } from "next/server";
import { getAuth, NEON_AUTH_COOKIE_PREFIX, SESSION_VERIFIER_PARAM } from "@/lib/auth/server";
import { DEFAULT_AFTER_LOGIN, LOGIN_PATH, safeNextPath } from "@/lib/auth/redirects";
import { INVITE_COOKIE, TOKEN_PATTERN } from "@/lib/sharing";

let authMiddleware: ((request: NextRequest) => Promise<NextResponse>) | null = null;

/**
 * Runs Neon Auth's middleware on every app route. It:
 * - completes Google sign-in: on return, the callback URL carries
 *   `neon_auth_session_verifier`, which it exchanges for session cookies;
 * - refreshes the session-data cookie;
 * - optimistically redirects signed-out visitors to /login.
 *
 * This is only a first gate. Pages and Server Actions verify the session
 * again through the data access layer (src/lib/dal.ts).
 */
export async function proxy(request: NextRequest) {
  const auth = getAuth();
  // Without configuration, pages render setup instructions instead.
  if (!auth) return NextResponse.next();

  authMiddleware ??= auth.middleware({ loginUrl: LOGIN_PATH });
  const response = await authMiddleware(request);

  // Rewrite the SDK's login redirect to carry a safe return path and reason.
  const location = response.headers.get("location");
  if (!location || request.nextUrl.pathname === LOGIN_PATH) return response;
  const target = new URL(location, request.url);
  if (target.origin !== request.nextUrl.origin || target.pathname !== LOGIN_PATH) return response;

  const login = new URL(LOGIN_PATH, request.url);
  const { pathname, search, searchParams } = request.nextUrl;
  if (searchParams.has(SESSION_VERIFIER_PARAM)) {
    // Came back from Google but the verifier could not be exchanged.
    login.searchParams.set("error", "callback");
  } else if (pathname.startsWith("/invite/") && TOKEN_PATTERN.test(pathname.slice("/invite/".length))) {
    // Signed out on an invitation link: keep the token in a short-lived first-party cookie and
    // send only "/invite" through sign-in, so the token never travels to the auth provider.
    login.searchParams.set("next", "/invite");
    const redirect = NextResponse.redirect(login);
    for (const cookie of response.headers.getSetCookie()) redirect.headers.append("set-cookie", cookie);
    redirect.cookies.set(INVITE_COOKIE, pathname.slice("/invite/".length), {
      path: "/",
      maxAge: 30 * 60,
      secure: true,
      httpOnly: true,
      sameSite: "lax",
    });
    return redirect;
  } else {
    const next = safeNextPath(`${pathname}${search}`);
    if (next !== DEFAULT_AFTER_LOGIN) login.searchParams.set("next", next);
    const hadSession = request.cookies
      .getAll()
      .some((c) => c.name.startsWith(NEON_AUTH_COOKIE_PREFIX) && c.name.endsWith(".session_token"));
    if (hadSession) login.searchParams.set("reason", "expired");
  }

  const redirect = NextResponse.redirect(login);
  for (const cookie of response.headers.getSetCookie()) redirect.headers.append("set-cookie", cookie);
  return redirect;
}

export const config = {
  matcher: [
    // Everything except Next internals, static files, and images.
    "/((?!_next/static|_next/image|favicon.ico|images/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif)$).*)",
  ],
};
