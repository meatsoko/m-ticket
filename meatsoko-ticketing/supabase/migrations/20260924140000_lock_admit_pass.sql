-- admit_pass was callable by anyone holding a pass token.
--
-- Confirmed against the live project with nothing but the public anon key:
--
--   POST /rest/v1/rpc/admit_pass {"p_token":"000…0","p_station":"probe"}
--     -> HTTP 200  {"result": "not_found"}
--
-- 200 means it ran. With a real token it would have admitted the pass, written
-- the redemptions row and set the reservation to checked_in, under whatever
-- station string the caller chose. Pass tokens are meant to be shared — they are
-- emailed, and there is a button for forwarding them over WhatsApp — so anyone
-- in a group chat where a pass was posted could burn it, and the guest would
-- meet a scanner saying "already admitted" with no override.
--
-- Cause: no migration ever revoked EXECUTE, and Postgres grants it to PUBLIC by
-- default. admit_pass performs no is_staff() check of its own; it relies on the
-- redeem Edge Function calling requireStaff(), which is a real boundary only
-- while nothing else can reach the function.
--
-- REVOKING FROM public IS THE LOAD-BEARING LINE. anon and authenticated inherit
-- the privilege through PUBLIC, so revoking from those two alone changes
-- nothing. They are listed as well to be explicit about intent and to survive
-- someone granting to them directly later.
--
-- Function logic is untouched. redeem/index.ts:29 is the only caller and it uses
-- the service-role client behind requireStaff(), so the staff path is unaffected
-- — it is only safe to revoke because desk check-in was moved off a direct
-- client-side RPC and onto redeem first.
--
-- Scope: admit_pass only. resolve_pass is also PUBLIC-callable and should get
-- the same treatment, but it is a separate change and is recorded in
-- REMAINING_GAPS.md rather than bundled here.

revoke execute on function public.admit_pass(text, text, uuid, timestamptz, integer) from public;
revoke execute on function public.admit_pass(text, text, uuid, timestamptz, integer) from anon;
revoke execute on function public.admit_pass(text, text, uuid, timestamptz, integer) from authenticated;

grant execute on function public.admit_pass(text, text, uuid, timestamptz, integer) to service_role;
