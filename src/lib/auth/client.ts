"use client";

import { createAuthClient } from "@neondatabase/auth/next";

/**
 * Browser auth client. It talks only to this app's /api/auth proxy (same
 * origin) — never to the database, and it holds no secrets.
 */
export const authClient = createAuthClient();
