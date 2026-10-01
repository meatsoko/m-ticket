// Investors' visit (migration 20261001150000). The same values are in
// supabase/functions/_shared/investor.ts, which the server checks — keep the two in step.
export const INVESTOR_DAY = "Friday 16 October 2026";
export const SALUTATIONS = ["Mr", "Mrs", "Ms", "Dr", "Prof", "Hon"] as const;
export const MAX_GUESTS = 10;
