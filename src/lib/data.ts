import "server-only";
import { cache } from "react";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validation";
import type { Booking, DocumentLink, Trip, TripWithDetails } from "@/lib/types";

/**
 * Reads run as the signed-in user through RLS, so every query only ever
 * returns that user's rows. No owner filter is needed for correctness, but
 * queries stay narrow and indexed.
 */

export const getTrips = cache(async (): Promise<Trip[]> => {
  if (!isSupabaseConfigured()) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("trips")
    .select("*")
    .order("start_date", { ascending: true });
  if (error) throw new Error(`Could not load trips: ${error.message}`);
  return data as Trip[];
});

export const getTrip = cache(async (tripId: string): Promise<TripWithDetails | null> => {
  if (!isSupabaseConfigured() || !idSchema.safeParse(tripId).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("trips")
    .select("*, bookings(*), document_links(*)")
    .eq("id", tripId)
    .order("start_date", { referencedTable: "bookings", ascending: true, nullsFirst: false })
    .order("start_time", { referencedTable: "bookings", ascending: true, nullsFirst: false })
    .order("created_at", { referencedTable: "document_links", ascending: true })
    .maybeSingle();
  if (error) throw new Error(`Could not load trip: ${error.message}`);
  if (!data) return null;
  return data as Trip & { bookings: Booking[]; document_links: DocumentLink[] };
});
