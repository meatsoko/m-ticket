-- Booth payments through Daraja into the TICKET till, as a temporary route while
-- the PayHero merchant account (Equity channel) waits for KYC (the user's call,
-- 2026-10-15). Opt-in only: VENDOR_SALES_PROVIDER=daraja + DARAJA_SALES_USE_MAIN_TILL=on.
-- Switching back is VENDOR_SALES_PROVIDER=payhero (CASHLESS_VENDORS.md §14).
--
-- Each Daraja ledger row records which Daraja credentials sent its prompt
-- ('main' = ticket till, 'sales' = the separate DARAJA_SALES_* account), so a
-- payment still being confirmed when the route changes is always queried with the
-- credentials that created it. Null = older rows: use `account`. No functions here.
alter table public.payhero_payments
  add column if not exists daraja_profile text check (daraja_profile is null or daraja_profile in ('main', 'sales'));
