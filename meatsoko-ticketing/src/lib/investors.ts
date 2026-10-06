// Investors' visit (migration 20261001150000). The same values are in
// supabase/functions/_shared/investor.ts, which the server checks — keep the two in step.
export const INVESTOR_DAY = "Friday 16 October 2026";
/** Start time, from the organiser's program (Day 1: arrival & registration 4:00 – 5:00 PM). */
export const INVESTOR_TIME = "From 4:00 PM";
export const INVESTOR_VENUE = "Thika Greens Golf Resort";  // the NyamaFest Main venue (concept note)
export const SALUTATIONS = ["Mr", "Mrs", "Ms", "Dr", "Prof", "Hon"] as const;
export const MAX_GUESTS = 10;
