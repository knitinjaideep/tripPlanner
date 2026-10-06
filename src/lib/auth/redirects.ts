export const LOGIN_PATH = "/login";
export const DEFAULT_AFTER_LOGIN = "/trips";

/**
 * Only same-origin, in-app paths are allowed as post-login destinations.
 * Rejects absolute URLs, protocol-relative (`//evil.com`), backslash tricks,
 * control characters, and auth/login routes (which would loop).
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw || typeof raw !== "string" || raw.length > 512) return DEFAULT_AFTER_LOGIN;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return DEFAULT_AFTER_LOGIN;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return DEFAULT_AFTER_LOGIN;

  let url: URL;
  try {
    url = new URL(raw, "http://rove.invalid");
  } catch {
    return DEFAULT_AFTER_LOGIN;
  }
  if (url.origin !== "http://rove.invalid") return DEFAULT_AFTER_LOGIN;
  if (url.pathname === LOGIN_PATH || url.pathname.startsWith("/api/") || url.pathname === "/") {
    return DEFAULT_AFTER_LOGIN;
  }
  url.searchParams.delete("neon_auth_session_verifier");
  return `${url.pathname}${url.search}`;
}
