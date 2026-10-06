import type { ItineraryPlan, PlanItem } from "./itinerary-plan";

/**
 * The Aruba family plan (Nitin, Pavani and baby Arjun, 14–19 Oct 2026).
 * Flight times are the traveler-confirmed anchors and come from the saved
 * bookings; every other time is an editable planning estimate. Nothing here
 * is a booking: no flight numbers, restaurants, tickets or rental company.
 *
 * Categories use the nearest existing values: Travel → transport,
 * Stay → lodging, Beach → activity.
 */

const D1 = "2026-10-14";
const D2 = "2026-10-15";
const D3 = "2026-10-16";
const D4 = "2026-10-17";
const D5 = "2026-10-18";
const D6 = "2026-10-19";

const VEG_DINNER = "Choose a vegetarian-friendly restaurant with a high chair where possible.";
const REST_NOTES = "Keep outings out of this window. Lunch, feeding, nap and downtime — the baby won’t necessarily sleep the whole time.";

const items: PlanItem[] = [
  /* Day 1 — arrive and settle in (15:20 landing comes from the flight booking) */
  {
    key: "d1-arrival-processing", date: D1, start: "15:20", end: "16:45", category: "transport",
    title: "Deplane, immigration, baggage & customs",
    notes: "Planning allowance. Immigration queues, baggage delivery and customs processing may take more or less time.",
  },
  {
    key: "d1-rental-pickup", date: D1, start: "16:45", end: "17:30", category: "transport",
    title: "Collect rental car & set up infant car seat",
    notes: "Allow for rental paperwork, loading luggage, checking the car seat, and a shuttle if the rental company is off-airport.",
  },
  {
    key: "d1-check-in", date: D1, start: "17:30", end: "18:15", category: "lodging",
    title: "Drive to accommodation & check in",
    notes: "Use the saved accommodation address and check-in instructions. Driving/check-in duration is an estimate.",
  },
  {
    key: "d1-settle", date: D1, start: "18:15", end: "19:00", category: "rest",
    title: "Feed Arjun, unpack essentials & rest",
    notes: "Follow baby’s needs after travel. Keep essentials accessible. This is not a fixed nap requirement.",
  },
  {
    key: "d1-dinner", date: D1, start: "19:00", end: "20:00", category: "food",
    title: "Easy dinner nearby or takeaway",
    notes: "Choose a convenient vegetarian-friendly option. High chair if dining out.",
  },
  {
    key: "d1-walk", date: D1, start: null, end: null, category: "activity", optional: true,
    title: "Short walk near the accommodation",
    notes: "Only if everyone has energy. No required sunset outing.",
  },

  /* Day 2 — Baby Beach morning */
  {
    key: "d2-breakfast", date: D2, start: "07:30", end: "08:15", category: "food",
    title: "Breakfast & prepare for the beach",
    notes: "Feed baby and pack shade, towels, water, snacks and swim supplies.",
  },
  {
    key: "d2-drive-baby-beach", date: D2, start: "08:15", end: "09:15", category: "transport",
    title: "Drive to Baby Beach",
    notes: "Allow roughly an hour as a planning buffer from Palm Beach/Noord. Confirm the actual route and conditions. Infant car seat required.",
  },
  {
    key: "d2-baby-beach", date: D2, start: "09:15", end: "11:00", category: "activity", placeName: "Baby Beach",
    title: "Baby Beach time", aliases: ["Baby Beach"],
    notes: "Relaxed beach visit with shade and breaks. Leave earlier if needed.",
  },
  {
    key: "d2-return", date: D2, start: "11:00", end: "12:00", category: "transport",
    title: "Return to accommodation",
    notes: "A similar return-driving buffer — aim to be back for rest. Replaces the earlier, too-tight 30-minute return.",
  },
  {
    key: "d2-rest", date: D2, start: "12:00", end: "15:00", category: "rest", protectedRest: true,
    title: "Lunch, baby nap & parents’ rest",
    notes: REST_NOTES,
  },
  {
    key: "d2-pool", date: D2, start: "15:30", end: "17:00", category: "activity", optional: true,
    title: "Pool or nearby beach",
    notes: "Keep the afternoon flexible. Use the accommodation pool if available or a nearby beach; don’t assume access to another hotel’s facilities.",
  },
  {
    key: "d2-dinner", date: D2, start: "17:00", end: "19:00", category: "food",
    title: "Sunset outing & early dinner",
    notes: `Flexible timing, not a verified sunset time. ${VEG_DINNER}`,
  },

  /* Day 3 — butterflies and Eagle Beach */
  { key: "d3-breakfast", date: D3, start: "07:30", end: "08:30", category: "food", title: "Breakfast", notes: null },
  {
    key: "d3-to-butterfly", date: D3, start: "08:30", end: "09:00", category: "transport",
    title: "Travel to the Butterfly Farm", notes: "Estimated travel buffer.",
  },
  {
    key: "d3-butterfly", date: D3, start: "09:00", end: "10:15", category: "activity", placeName: "Butterfly Farm",
    title: "Butterfly Farm visit", aliases: ["Butterfly Farm"],
    notes: "Short visit with baby. Confirm opening hours and admission details.",
  },
  {
    key: "d3-to-eagle", date: D3, start: "10:15", end: "10:30", category: "transport",
    title: "Travel to Eagle Beach", notes: "Estimated travel buffer; adjust to the actual location.",
  },
  {
    key: "d3-eagle", date: D3, start: "10:30", end: "11:30", category: "activity", placeName: "Eagle Beach",
    title: "Eagle Beach", notes: "A relaxed stop. Shorten or skip if baby is tired.",
  },
  {
    key: "d3-return", date: D3, start: "11:30", end: "12:00", category: "transport",
    title: "Return to accommodation", notes: "Allow time to get back before the midday rest window.",
  },
  {
    key: "d3-rest", date: D3, start: "12:00", end: "15:00", category: "rest", protectedRest: true,
    title: "Lunch, baby nap & parents’ rest", notes: "Keep this window free of outings.",
  },
  {
    key: "d3-pool", date: D3, start: "15:30", end: "17:00", category: "activity", optional: true,
    title: "Pool or nearby beach", notes: "Free time.",
  },
  {
    key: "d3-dinner", date: D3, start: "17:00", end: "19:00", category: "food",
    title: "Sunset outing & early dinner", notes: "Keep the evening flexible; vegetarian-friendly dinner.",
  },

  /* Day 4 — Arashi Beach and a relaxed afternoon */
  { key: "d4-breakfast", date: D4, start: "07:30", end: "08:15", category: "food", title: "Breakfast", notes: null },
  {
    key: "d4-drive-arashi", date: D4, start: "08:15", end: "08:45", category: "transport",
    title: "Drive to Arashi Beach", notes: "Estimated travel buffer. Bring baby shade and beach supplies.",
  },
  {
    key: "d4-arashi", date: D4, start: "08:45", end: "11:30", category: "activity", placeName: "Arashi Beach",
    title: "Arashi Beach time", aliases: ["Arashi Beach"],
    notes: "Don’t rush. Leave earlier if baby needs a break.",
  },
  {
    key: "d4-return", date: D4, start: "11:30", end: "12:00", category: "transport",
    title: "Return to accommodation", notes: "Aim to be back before the rest window.",
  },
  {
    key: "d4-rest", date: D4, start: "12:00", end: "15:00", category: "rest", protectedRest: true,
    title: "Lunch, baby nap & parents’ rest", notes: null,
  },
  {
    key: "d4-pool", date: D4, start: "15:30", end: "17:00", category: "activity", optional: true,
    title: "Pool or nearby beach", notes: "Relaxed afternoon.",
  },
  {
    key: "d4-dinner", date: D4, start: "17:00", end: "19:00", category: "food",
    title: "Sunset outing & early dinner", notes: "Try a different vegetarian-friendly restaurant if convenient.",
  },

  /* Day 5 — animals and Oranjestad */
  { key: "d5-breakfast", date: D5, start: "07:30", end: "08:30", category: "food", title: "Breakfast", notes: null },
  {
    key: "d5-to-animals", date: D5, start: "08:30", end: "09:00", category: "transport",
    title: "Travel to the selected animal attraction",
    notes: "Destination depends on the chosen attraction — recheck the drive time after choosing. Infant car seat required.",
  },
  {
    key: "d5-animals", date: D5, start: "09:00", end: "11:00", category: "activity",
    title: "Donkey Sanctuary or Philip’s Animal Garden",
    notes: "Choose ONE, not both. Confirm opening hours and admission details. Undecided until you pick one.",
  },
  {
    key: "d5-return", date: D5, start: "11:00", end: "12:00", category: "transport",
    title: "Return to accommodation", notes: "Flexible return buffer depending on which attraction you choose.",
  },
  {
    key: "d5-rest", date: D5, start: "12:00", end: "15:00", category: "rest", protectedRest: true,
    title: "Lunch, baby nap & parents’ rest", notes: null,
  },
  {
    key: "d5-to-oranjestad", date: D5, start: "15:00", end: "15:30", category: "transport",
    title: "Travel to Oranjestad", notes: "Estimated travel buffer. Allow for parking.",
  },
  {
    key: "d5-oranjestad", date: D5, start: "15:30", end: "17:00", category: "activity",
    title: "Oranjestad sightseeing", notes: "Easy walking, shade breaks and a relaxed pace.",
  },
  {
    key: "d5-waterfront", date: D5, start: "17:00", end: "19:00", category: "food",
    title: "Waterfront, early dinner & optional shopping",
    notes: "Vegetarian-friendly dinner — ask for a high chair. Shopping and sunset viewing are optional.",
  },
  {
    key: "d5-return-evening", date: D5, start: "19:00", end: "20:00", category: "transport",
    title: "Return to accommodation & wind down", notes: "Flexible return and settling-in window.",
  },

  /* Day 6 — pack up and head home (15:10 departure comes from the flight booking) */
  { key: "d6-breakfast", date: D6, start: "07:30", end: "08:30", category: "food", title: "Breakfast & packing", notes: null },
  {
    key: "d6-quiet", date: D6, start: "08:30", end: "09:30", category: "activity", optional: true,
    title: "Quiet time or a short pool visit",
    notes: "Only if bags are nearly ready and baby’s routine allows. Stay close to the accommodation; no distant beach outing.",
  },
  {
    key: "d6-finish-packing", date: D6, start: "09:30", end: "10:15", category: "rest",
    title: "Shower, feed/change baby & finish packing",
    notes: "Keep flight snacks, baby supplies and travel documents in carry-ons.",
  },
  {
    key: "d6-checkout", date: D6, start: "10:15", end: "10:30", category: "lodging",
    title: "Check out & load the car", notes: "Verify the saved property’s checkout requirements.",
  },
  {
    key: "d6-to-rental", date: D6, start: "10:30", end: "11:15", category: "transport",
    title: "Drive toward rental return & refuel if required",
    notes: "Confirm the return location and fuel policy. This is a planning allowance.",
  },
  {
    key: "d6-rental-return", date: D6, start: "11:15", end: "12:10", category: "transport",
    title: "Return rental car & transfer to departure terminal",
    notes: "Includes unloading, car-seat handover if applicable, and the shuttle or walk. Confirm with the rental company. Leave the accommodation earlier if needed.",
  },
  {
    key: "d6-terminal", date: D6, start: "12:10", end: null, category: "transport",
    title: "Target arrival at the U.S.-bound departure terminal",
    notes: "Three hours before the scheduled 15:10 departure, after returning the rental car. Follow the airport’s entry window and the airline’s instructions.",
  },
  {
    key: "d6-formalities", date: D6, start: "12:10", end: null, category: "transport",
    title: "Check-in, security, departure formalities & U.S. preclearance",
    notes: "Duration varies — queue times are unknown, so no end time is set. Boarding time comes from the airline.",
  },
  {
    key: "d6-airport-rest", date: D6, start: null, end: null, category: "rest",
    title: "Food, diaper change & baby rest",
    notes: "After formalities, as time permits. No guaranteed airport nap window.",
  },
];

export const ARUBA_2026: ItineraryPlan = {
  id: "aruba-2026",
  label: "Aruba family plan",
  destination: /aruba/i,
  startDate: D1,
  endDate: D6,
  timeZone: "America/Aruba",
  travelers: ["Nitin", "Pavani", "Arjun"],
  stayName: "Elegant Palm Retreat",
  days: [
    { date: D1, theme: "Arrive and settle in" },
    { date: D2, theme: "Baby Beach morning" },
    { date: D3, theme: "Butterflies and Eagle Beach" },
    { date: D4, theme: "Arashi Beach and a relaxed afternoon" },
    { date: D5, theme: "Animals and Oranjestad" },
    { date: D6, theme: "Pack up and head home" },
  ],
  anchors: [
    { kind: "arrival", date: D1, time: "15:20", airport: "AUA" },
    { kind: "departure", date: D6, time: "15:10", airport: "AUA" },
  ],
  stayChecks: { checkInBy: "17:30", checkOutAt: "10:15" },
  items,
  retire: [
    { label: "Outdated: noon arrival / check-in", date: D1, title: /arriv|check.?in|land/i, from: "11:00", to: "13:30" },
    { label: "Outdated: 15:00 nap at the accommodation", date: D1, title: /\bnap\b/i, from: "14:30", to: "15:30" },
    { label: "Outdated: fixed 17:00 sunset outing", date: D1, title: /sunset/i, from: "16:30", to: "17:30" },
    { label: "Outdated: departure-day nap at the accommodation", date: D6, title: /\bnap\b/i, from: "11:30", to: "15:00" },
    { label: "Looks like a copy of your saved arrival flight", date: D1, title: /\bflight\b|\bAUA\b/i },
    { label: "Looks like a copy of your saved departure flight", date: D6, title: /\bflight\b|\bAUA\b/i },
  ],
};

/** Saved plans, matched to a trip by destination. */
export const PLANS = [ARUBA_2026];
