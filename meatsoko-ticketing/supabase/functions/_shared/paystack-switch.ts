// Kill switch for new Paystack payments (2026-10-06, urgent: the user asked for
// every Paystack transaction to stop). Off unless the PAYSTACK_PAYMENTS secret is
// exactly "on", so a missing secret fails closed:
//   supabase secrets set PAYSTACK_PAYMENTS=on   -> payments open again (no redeploy)
//
// Only *opening* a payment is blocked (transaction/initialize). Verifying and
// reconciling references that already exist still runs, so anyone who paid before
// the switch is still confirmed and gets their pass or order.
export const paystackPaused = () => Deno.env.get("PAYSTACK_PAYMENTS")?.trim().toLowerCase() !== "on";
