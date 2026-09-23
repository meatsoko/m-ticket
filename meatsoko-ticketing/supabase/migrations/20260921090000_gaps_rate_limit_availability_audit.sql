-- ============================================================
-- Closes the open items from the 2026-09-20 pre-launch audit.
--   1. rate limiting store + atomic check-and-increment (NFR-5)
--   2. availability with soft holds, so concurrent buyers can't oversell (R3, FR-E1)
--   3. refund actor/timestamp/reversal reference + admin audit log (FR-A3, NFR-4)
-- ============================================================

-- ---------- 1. Rate limiting (NFR-5) ----------
-- stk-push and lookup are public and unauthenticated. Without a throttle, anyone can
-- push unlimited M-Pesa PIN prompts to arbitrary numbers using our shortcode, or
-- enumerate ticket holders by phone. Counters live in Postgres rather than in an edge
-- isolate because isolates are per-region and short-lived.
create table if not exists public.rate_limits (
  bucket       text primary key,
  hits         integer not null default 0,
  window_start timestamptz not null default now()
);

alter table public.rate_limits enable row level security;
-- No policies: service role only. RLS denies everyone else by default (NFR-4).

create or replace function public.rate_limit_hit(
  p_bucket text, p_limit integer, p_window_seconds integer
) returns jsonb
language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_row public.rate_limits%rowtype;
begin
  insert into public.rate_limits as rl (bucket, hits, window_start)
  values (p_bucket, 1, now())
  on conflict (bucket) do update
     set hits = case
           when rl.window_start < now() - make_interval(secs => p_window_seconds) then 1
           else rl.hits + 1 end,
         window_start = case
           when rl.window_start < now() - make_interval(secs => p_window_seconds) then now()
           else rl.window_start end
  returning * into v_row;

  return jsonb_build_object(
    'allowed', v_row.hits <= p_limit,
    'hits', v_row.hits,
    'retry_after', greatest(
      0,
      ceil(p_window_seconds - extract(epoch from (now() - v_row.window_start)))
    )::int
  );
end; $$;

-- Housekeeping: buckets are disposable once their window has long passed.
create or replace function public.rate_limit_gc() returns void
language sql security definer set search_path = public as $$
  delete from public.rate_limits where window_start < now() - interval '1 day';
$$;


-- ---------- 2. Availability with soft holds (R3, FR-E1) ----------
-- confirm_payment's cap check counts only tickets that already exist, so N concurrent
-- buyers could all pass it and all pay. Counting in-flight orders here lets stk-push
-- refuse before taking money. The hold expires with the STK window so an abandoned
-- checkout cannot block the cap for long.
create or replace function public.availability(p_event_id uuid)
returns table (
  ticket_type_id uuid,
  quantity_cap   integer,
  sold           integer,
  held           integer,
  remaining      integer
)
language sql stable security definer
set search_path = public, extensions as $$
  select
    tt.id,
    tt.quantity_cap,
    s.sold,
    h.held,
    case when tt.quantity_cap is null then null
         else greatest(0, tt.quantity_cap - s.sold - h.held) end
  from public.ticket_types tt
  cross join lateral (
    select coalesce(count(*), 0)::int * tt.bundle_qty as sold
      from public.tickets t
     where t.ticket_type_id = tt.id
       and t.status <> 'refunded'
  ) s
  cross join lateral (
    select coalesce(sum(oi.qty), 0)::int * tt.bundle_qty as held
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
     where oi.ticket_type_id = tt.id
       and o.status = 'pending'
       and o.created_at > now() - interval '10 minutes'
  ) h
  where tt.event_id = p_event_id
    and tt.is_active;
$$;

-- Public event page needs remaining counts to render "Sold out" (FR-E1).
grant execute on function public.availability(uuid) to anon, authenticated;


-- ---------- 3. Refund accountability (FR-A3, NFR-4) ----------
-- FR-A3 requires the actor, the timestamp and the M-Pesa reversal reference; the
-- original refund_order recorded only a free-text reason.
alter table public.orders add column if not exists refunded_by  uuid references auth.users(id);
alter table public.orders add column if not exists refunded_at  timestamptz;
alter table public.orders add column if not exists reversal_ref text;

-- NFR-4: "all admin mutations logged". Append-only; service role / definer writes only.
create table if not exists public.admin_audit (
  id         uuid primary key default gen_random_uuid(),
  actor      uuid references auth.users(id),
  action     text not null,
  subject_id uuid,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.admin_audit enable row level security;

drop policy if exists "admin read audit" on public.admin_audit;
create policy "admin read audit" on public.admin_audit
  for select using (public.is_admin());

create index if not exists admin_audit_created_at_idx on public.admin_audit (created_at desc);

create or replace function public.refund_order(
  p_order_id uuid, p_reason text, p_reversal_ref text default null
) returns jsonb
language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
begin
  if not public.is_admin() then
    return jsonb_build_object('result', 'forbidden');
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  -- Flagged orders are money taken that produced no usable ticket, so they must be
  -- refundable too — the original policy only allowed 'paid'.
  if v_order.status not in ('paid', 'flagged') then
    return jsonb_build_object('result', 'ignored', 'status', v_order.status);
  end if;

  update public.orders
     set status = 'refunded',
         refund_reason = p_reason,
         reversal_ref = p_reversal_ref,
         refunded_by = v_actor,
         refunded_at = now()
   where id = p_order_id;

  update public.tickets set status = 'refunded'
   where order_id = p_order_id and status <> 'refunded';

  insert into public.admin_audit (actor, action, subject_id, detail)
  values (v_actor, 'refund_order', p_order_id, jsonb_build_object(
    'reason', p_reason,
    'reversal_ref', p_reversal_ref,
    'previous_status', v_order.status,
    'amount_kes', v_order.amount_kes
  ));

  return jsonb_build_object('result', 'refunded', 'order_id', p_order_id);
end; $$;

-- The 2-arg signature is replaced by the 3-arg one above; drop it so PostgREST does not
-- keep offering an overload that silently skips the reversal reference.
drop function if exists public.refund_order(uuid, text);
