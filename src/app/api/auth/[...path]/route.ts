import { getAuth } from "@/lib/auth/server";

/**
 * Neon Auth's required route: proxies /api/auth/* (sign-in, OAuth callback
 * hand-off, get-session, sign-out…) to the branch's Neon Auth service and
 * manages the session cookies. It only speaks the auth protocol — there is
 * no database access here.
 */

type Context = RouteContext<"/api/auth/[...path]">;

function notConfigured() {
  return Response.json({ error: "Authentication is not configured." }, { status: 503 });
}

export async function GET(request: Request, context: Context) {
  const handler = getAuth()?.handler();
  return handler ? handler.GET(request, context) : notConfigured();
}

export async function POST(request: Request, context: Context) {
  const handler = getAuth()?.handler();
  return handler ? handler.POST(request, context) : notConfigured();
}
