-- Refunds for event payments, from the dashboard's Tickets > Payments & refunds.
--
-- refund_order() records a refund made in the Paystack dashboard, but leaves the
-- booking untouched: a refunded table would still admit the whole table. This
-- adds refund_event_order(), which records the refund AND applies an explicit
-- outcome to the booking, atomically:
--
--   'cancel'   refund and cancel the booking (the gate then refuses the pass).
--              A booking already checked in is left checked in.
--   'keep_ga'  refund a TABLE UPGRADE and put the booking back to its free
--              General Admission ticket (1 person, no order). Same pass, same QR.
--              Only for upgrades (reservation_upgrades), and refused before any
--              change if the booking isn't one.
--   'keep'     refund only; the booking stays as it is (e.g. a duplicate payment
--              flagged by the upgrade flow, which isn't linked to a booking).
--
-- Money is still returned in the Paystack dashboard; this only records it.
-- Admin only (is_admin() inside), written to admin_audit like refund_order.
-- refund_order() is unchanged and still used by the ticketed-event screen.

alter table public.reservation_upgrades drop constraint if exists reservation_upgrades_status_check;
alter table public.reservation_upgrades add constraint reservation_upgrades_status_check
  check (status in ('pending', 'superseded', 'applied', 'conflict', 'failed', 'refunded'));

create or replace function public.refund_event_order(
  p_order_id uuid, p_reason text, p_reversal_ref text default null, p_outcome text default 'keep'
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
  v_res   public.reservations%rowtype;
  v_up    public.reservation_upgrades%rowtype;
  v_ga    uuid;
  v_note  text := null;
begin
  if not public.is_admin() then return jsonb_build_object('result', 'forbidden'); end if;
  if p_outcome not in ('cancel', 'keep_ga', 'keep') then return jsonb_build_object('result', 'bad_outcome'); end if;
  if coalesce(btrim(p_reason), '') = '' then return jsonb_build_object('result', 'reason_required'); end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if v_order.status not in ('paid', 'flagged') then
    return jsonb_build_object('result', 'ignored', 'status', v_order.status);
  end if;

  -- The booking this payment belongs to: a table booking (order_id) or, for a
  -- table upgrade, the upgraded booking.
  select * into v_up from public.reservation_upgrades where order_id = p_order_id;
  select * into v_res from public.reservations
   where id = coalesce(v_up.reservation_id, (select r.id from public.reservations r where r.order_id = p_order_id))
   for update;

  if p_outcome = 'keep_ga' then
    if v_up.id is null or v_res.id is null or v_res.order_id is distinct from p_order_id then
      return jsonb_build_object('result', 'not_an_upgrade');
    end if;
    select t.id into v_ga from public.reservation_types t
     where t.event_id = v_res.event_id and t.is_general_admission order by t.is_active desc, t.position limit 1;
    if v_ga is null then return jsonb_build_object('result', 'no_general_admission'); end if;
  end if;

  update public.orders
     set status = 'refunded', refund_reason = p_reason, reversal_ref = p_reversal_ref,
         refunded_by = v_actor, refunded_at = now()
   where id = p_order_id;
  update public.tickets set status = 'refunded' where order_id = p_order_id and status <> 'refunded';

  if p_outcome = 'cancel' and v_res.id is not null then
    if v_res.status in ('confirmed', 'pending_payment') then
      update public.reservations set status = 'cancelled' where id = v_res.id;
    else
      v_note := 'booking_' || v_res.status::text;   -- e.g. already checked in: left as is
    end if;
  elsif p_outcome = 'keep_ga' then
    update public.reservations
       set reservation_type_id = v_ga, accompanying_guests = 0, order_id = null
     where id = v_res.id;
    update public.reservation_upgrades set status = 'refunded' where id = v_up.id;
  end if;

  insert into public.admin_audit (actor, action, subject_id, detail)
  values (v_actor, 'refund_event_order', p_order_id, jsonb_build_object(
    'reason', p_reason, 'reversal_ref', p_reversal_ref, 'outcome', p_outcome, 'note', v_note,
    'previous_status', v_order.status, 'amount_kes', v_order.amount_kes,
    'reservation_number', v_res.reservation_number));

  return jsonb_build_object('result', 'refunded', 'order_id', p_order_id, 'outcome', p_outcome,
    'reservation_number', v_res.reservation_number, 'note', v_note);
end; $$;

-- Admins call this from the dashboard as `authenticated`; it checks is_admin().
revoke all on function public.refund_event_order(uuid, text, text, text) from public, anon;
grant execute on function public.refund_event_order(uuid, text, text, text) to authenticated, service_role;
