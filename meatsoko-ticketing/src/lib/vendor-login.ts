import { normalizePhone } from "@/lib/phone";

/**
 * Vendors sign in with their phone number and a password an admin gave them
 * (migration 20261015100000). Supabase Auth needs an email-shaped identifier, so
 * each vendor's account uses an internal address derived from the phone — never
 * emailed, never shown. Must match vendorLoginEmail() in
 * supabase/functions/vendor-invite/index.ts.
 */
export function vendorLoginEmail(rawPhone: string): string | null {
  const phone = normalizePhone(rawPhone);
  return phone ? `v${phone}@vendors.meatsokogroup.com` : null;
}
