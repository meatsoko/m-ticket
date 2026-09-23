/**
 * Client-side mirror of normalizePhone() in supabase/functions/_shared/supabase.ts.
 *
 * Duplicated deliberately: the server stays the authority and re-validates every
 * submission, but the guest should be told their number is wrong while they are
 * still looking at the field, not after a round trip.
 */
export function normalizePhone(raw: string): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (/^2547\d{8}$/.test(digits)) return digits;
  if (/^07\d{8}$/.test(digits)) return "254" + digits.slice(1);
  if (/^7\d{8}$/.test(digits)) return "254" + digits;
  return null;
}

export const PHONE_HINT = "Use the format 07XX XXX XXX";

/**
 * Mirror of looks_like_email() in the database. Deliberately loose: real
 * deliverability is proven by the mail arriving, not by a regex. This only
 * catches obvious typing errors while the guest is still looking at the field.
 */
export function looksLikeEmail(raw: string): boolean {
  const v = (raw ?? "").trim();
  return v !== "" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
}

export const EMAIL_HINT = "We send your pass and QR code here";
