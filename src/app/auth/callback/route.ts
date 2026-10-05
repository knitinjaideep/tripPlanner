import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Only allow same-origin relative paths as post-login destinations. */
function safeNext(next: string | null) {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return "/trips";
  }
  return next;
}

/**
 * Google → Supabase → here with a one-time PKCE code. Exchanging it sets the
 * session cookies, then we continue into the app.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, origin));
    console.error("[rove] auth callback:", error.code, error.message);
  }

  const login = new URL("/login", origin);
  const providerError = searchParams.get("error_description") ?? searchParams.get("error");
  login.searchParams.set("error", providerError ? "provider" : "callback");
  return NextResponse.redirect(login);
}
