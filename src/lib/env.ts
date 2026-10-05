/**
 * Public Supabase configuration. Both values are safe to expose to the
 * browser (the publishable key only grants what RLS allows). Never put a
 * secret/service-role key in a NEXT_PUBLIC_ variable.
 */
export function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return null;
  return { url, publishableKey };
}

export function isSupabaseConfigured() {
  return getSupabaseEnv() !== null;
}

export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local.",
    );
  }
}

export function requireSupabaseEnv() {
  const env = getSupabaseEnv();
  if (!env) throw new SupabaseNotConfiguredError();
  return env;
}
