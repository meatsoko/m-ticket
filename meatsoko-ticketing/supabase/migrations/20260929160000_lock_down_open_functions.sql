-- Lock down the SECURITY DEFINER functions that anyone could still call.
--
-- Same cause and same fix as 20260924140000_lock_admit_pass.sql: no migration
-- ever revoked EXECUTE, and Postgres grants it to PUBLIC by default (Supabase's
-- default privileges also grant anon and authenticated directly). Confirmed live
-- on 2026-09-29 with `select proacl from pg_proc`: each of these showed
-- `=X/postgres` (PUBLIC), `anon=X` and `authenticated=X`.
--
-- What that allowed, with nothing but the public anon key:
--   confirm_payment     mark an M-Pesa order PAID and issue its tickets, given the
--                       order's CheckoutRequestID (which the buyer's own browser
--                       receives) — tickets without paying. Dormant only because
--                       Daraja is not provisioned.
--   create_reservation  book directly, skipping the reserve Edge Function's
--                       throttle, email checks and the new one-booking-per-phone
--                       ownership rule.
--   resolve_pass        read a pass's holder name and party size from a token.
--   rate_limit_hit/_gc  fill or reset other people's throttle buckets.
--   gen_reservation_number  harmless alone; internal only.
--   refund_order        already refuses non-admins inside; anon still does not
--                       need to reach it.
--
-- Callers, checked before revoking (grep of src/ and supabase/functions/):
--   confirm_payment     daraja-callback  (service-role client)
--   create_reservation  reserve          (service-role client)
--   rate_limit_hit      every Edge Function via _shared/supabase.ts (service role)
--   refund_order        admin dashboard, in the browser as the signed-in admin
--                       (authenticated) — so authenticated KEEPS it; the function
--                       checks is_admin() itself.
--   resolve_pass, gen_reservation_number, rate_limit_gc — only other SECURITY
--   DEFINER functions (admit_pass, create_reservation, rate_limit_hit), which run
--   as their owner and are unaffected.
--
-- REVOKING FROM public IS THE LOAD-BEARING LINE; anon and authenticated are listed
-- too because Supabase grants them directly as well. Function bodies unchanged.
--
-- Deliberately NOT touched: availability and expected_attendance (the public
-- event page calls them), is_staff / is_admin (RLS policies evaluate them as the
-- querying role), looks_like_email (a CHECK-constraint helper), and Supabase's
-- own rls_auto_enable.

revoke all on function public.confirm_payment(text, text, numeric) from public, anon, authenticated;
grant execute on function public.confirm_payment(text, text, numeric) to service_role;

revoke all on function public.create_reservation(uuid, text, text, text, integer, time without time zone, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function public.create_reservation(uuid, text, text, text, integer, time without time zone, jsonb, text, uuid) to service_role;

revoke all on function public.gen_reservation_number(text) from public, anon, authenticated;
grant execute on function public.gen_reservation_number(text) to service_role;

revoke all on function public.rate_limit_gc() from public, anon, authenticated;
grant execute on function public.rate_limit_gc() to service_role;

revoke all on function public.rate_limit_hit(text, integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer, boolean) to service_role;

revoke all on function public.resolve_pass(text) from public, anon, authenticated;
grant execute on function public.resolve_pass(text) to service_role;

-- Admins call this from the dashboard as `authenticated`; it checks is_admin().
revoke all on function public.refund_order(uuid, text, text) from public, anon;
grant execute on function public.refund_order(uuid, text, text) to authenticated, service_role;
