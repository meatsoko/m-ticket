// PayHero M-Pesa (migration 20261008090000), shown alongside Paystack.
// The "Pay with M-Pesa" option appears only when NEXT_PUBLIC_PAYHERO_PAYMENTS is
// exactly "on" (Vercel). The Edge Functions refuse independently unless the
// PAYHERO_PAYMENTS Supabase secret is "on" — this flag is the friendly face,
// not the lock.
export const MPESA_ENABLED = process.env.NEXT_PUBLIC_PAYHERO_PAYMENTS === "on";
