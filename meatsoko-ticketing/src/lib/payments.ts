// Paystack is paused (2026-10-06, the user's urgent request): every button that would
// open a Paystack payment is greyed out with PAYMENT_PAUSED_MESSAGE. The Edge Functions
// refuse independently (supabase/functions/_shared/paystack-switch.ts), so this is the
// friendly face of that switch, not the lock itself.
//
// Off unless NEXT_PUBLIC_PAYSTACK_PAYMENTS is exactly "on". To re-open payments, set it
// in Vercel and redeploy, and set the PAYSTACK_PAYMENTS Supabase secret to "on".
export const PAYMENTS_PAUSED = process.env.NEXT_PUBLIC_PAYSTACK_PAYMENTS !== "on";

export const PAYMENT_PAUSED_MESSAGE = "Payment coming soon — online payment isn't open yet. Please check back shortly.";
