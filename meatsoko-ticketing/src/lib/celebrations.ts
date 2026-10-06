// Occasion booking (migration 20261007120000). Labels shared by the form, the
// guest's page and the dashboard. Also in supabase/functions/_shared/celebration.ts
// — keep the two in step.

export const OCCASIONS = [
  { value: "birthday", label: "Birthday" },
  { value: "anniversary", label: "Anniversary" },
  { value: "graduation", label: "Graduation" },
  { value: "wedding", label: "Wedding" },
  { value: "baby_shower", label: "Baby shower" },
  { value: "family", label: "Family gathering" },
  { value: "corporate", label: "Corporate or team day" },
  { value: "other", label: "Something else" },
] as const;
export type Occasion = (typeof OCCASIONS)[number]["value"];

export const SETTINGS = [
  { value: "meatsoko", label: "At a MeatSoko venue" },
  { value: "own_venue", label: "At our place or venue" },
  { value: "not_sure", label: "Not sure yet" },
] as const;

/** The guest's own budget range (optional) — a guide for the quote, not a MeatSoko price. */
export const BUDGETS = [
  { value: "under_25k", label: "Under KSh 25k" },
  { value: "25k_50k", label: "KSh 25k – 50k" },
  { value: "50k_100k", label: "KSh 50k – 100k" },
  { value: "100k_250k", label: "KSh 100k – 250k" },
  { value: "over_250k", label: "Over KSh 250k" },
] as const;

export const STATUSES = {
  new: "Received", contacted: "We're in touch", confirmed: "Confirmed", declined: "Not possible",
  cancelled: "Cancelled", completed: "Done",
} as const;
export type CelebrationStatus = keyof typeof STATUSES;

export const MIN_NOTICE_DAYS = 2;

export const label = <T extends { value: string; label: string }>(list: readonly T[], v: string | null | undefined) =>
  list.find((x) => x.value === v)?.label ?? v ?? "";

export const occasionLabel = (occasion: string, other?: string | null) =>
  occasion === "other" && other ? other : label(OCCASIONS, occasion);

/** "2026-11-14" -> "Saturday 14 November 2026" (a calendar date, no time zone games). */
export const celebrationDate = (d: string) =>
  new Intl.DateTimeFormat("en-KE", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${d}T00:00:00Z`));
