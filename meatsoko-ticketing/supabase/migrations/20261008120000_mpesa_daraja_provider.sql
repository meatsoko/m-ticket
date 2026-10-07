-- Daraja M-Pesa Express (STK push to MeatSoko's own till) as a second M-Pesa
-- provider beside PayHero, sharing PayHero's ledger and confirmation functions
-- (migration 20261008090000). The user's choice on 2026-10-07: Daraja becomes
-- the default once a live KSh 1 test passes; PayHero stays as the fallback,
-- switched by the MPESA_PROVIDER secret (daraja | payhero; unset = payhero).
--
-- The confirm_payhero_* and fail_payhero_payment functions are keyed on our own
-- "PH…" reference and never look at the provider, so both providers share the
-- same business rules. What differs is only how a payment is VERIFIED before
-- those functions run (see supabase/functions/_shared/mpesa.ts): PayHero's
-- transaction-status API, or Safaricom's STK Push Query. Neither provider's
-- callback is ever trusted on its own — Safaricom's callback is unsigned too.
--
-- checkout_request_id (Safaricom's CheckoutRequestID) becomes unique so the
-- Daraja callback can find its payment. No new functions, so nothing to revoke.
alter table public.payhero_payments
  add column if not exists provider text not null default 'payhero' check (provider in ('payhero', 'daraja'));
alter table public.payhero_payments add column if not exists merchant_request_id text;
create unique index if not exists payhero_payments_checkout_uniq
  on public.payhero_payments (checkout_request_id) where checkout_request_id is not null;
