-- Vendors: "Become a vendor" on the event page. A vendor registers (name, phone,
-- email, vendor type, optional description) and pays a fixed tent fee through
-- Paystack. The registration exists from the moment they submit and stays
-- `pending_payment` until Paystack confirms the money; an abandoned payment
-- leaves it pending (visible in the dashboard), and submitting again from the
-- same phone for the same event reuses that pending row with a new payment.
--
-- Money: KES, the fee is set by the vendor-apply Edge Function (3,500) and
-- stored on the row; confirmation checks the amount Paystack reports against it.
-- References are "MV" + 32 hex, routed by paystack-verify / -webhook /
-- -reconcile to confirm_vendor_payment.
--
-- Access: no public access at all (RLS on, no anon policies). Writes happen in
-- the Edge Function with the service role; staff read and admins update status
-- (e.g. cancel, mark refunded) from the dashboard.

create table if not exists public.vendor_applications (
  id                 uuid primary key default gen_random_uuid(),
  event_id           uuid not null references public.events(id) on delete cascade,
  reference_number   text not null unique,                     -- VEN-XXXXXX, for phone support
  name               text not null check (length(btrim(name)) between 2 and 120),
  phone              text not null check (phone ~ '^254[0-9]{9}$'),
  email              text not null check (public.looks_like_email(email)),
  vendor_type        text not null check (vendor_type in ('food', 'drinks', 'merchandise', 'services', 'other')),
  description        text check (description is null or length(description) <= 500),
  amount_kes         numeric(10,2) not null check (amount_kes > 0),
  status             text not null default 'pending_payment'
                     check (status in ('pending_payment', 'paid', 'flagged', 'cancelled', 'refunded')),
  paystack_reference text unique,
  -- References of earlier payment attempts (a retry opens a new one). A payment
  -- made on an old tab is still matched to this registration.
  prior_references   text[] not null default '{}',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  paid_at            timestamptz,
  flag_reason        text,
  admin_note         text
);
create index if not exists vendor_applications_prior_refs_idx on public.vendor_applications using gin (prior_references);
create index if not exists vendor_applications_event_idx on public.vendor_applications (event_id, created_at desc);
-- One live registration per phone per event: a pending one is reused, a paid one blocks a duplicate.
create unique index if not exists vendor_applications_one_per_phone
  on public.vendor_applications (event_id, phone) where status in ('pending_payment', 'paid', 'flagged');

alter table public.vendor_applications enable row level security;
revoke all on table public.vendor_applications from anon, authenticated;
grant select, update on table public.vendor_applications to authenticated;
drop policy if exists vendor_applications_staff_read on public.vendor_applications;
create policy vendor_applications_staff_read on public.vendor_applications
  for select to authenticated using (public.is_staff());
drop policy if exists vendor_applications_admin_update on public.vendor_applications;
create policy vendor_applications_admin_update on public.vendor_applications
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Paystack says it was paid: pending -> paid, if the amount matches the fee.
create or replace function public.confirm_vendor_payment(p_reference text, p_amount_kes numeric)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v public.vendor_applications%rowtype;
begin
  select * into v from public.vendor_applications
   where paystack_reference = p_reference or p_reference = any(prior_references) for update;
  if not found then return jsonb_build_object('result', 'unknown'); end if;
  if v.status = 'paid' then
    if p_reference is distinct from v.paystack_reference and coalesce(v.flag_reason, '') not like '%' || p_reference || '%' then
      -- A second payment (an old tab) for a tent already paid: keep the tent,
      -- flag the extra money for a refund.
      update public.vendor_applications
         set flag_reason = concat_ws('; ', flag_reason, 'duplicate_payment ' || p_reference), updated_at = now()
       where id = v.id;
      return jsonb_build_object('result', 'duplicate_payment', 'id', v.id);
    end if;
    return jsonb_build_object('result', 'already', 'id', v.id);
  end if;
  if v.status <> 'pending_payment' then
    -- Cancelled after the guest paid anyway: record it for a refund, never drop money.
    update public.vendor_applications set status = 'flagged', flag_reason = 'paid_after_' || v.status,
           paid_at = now(), updated_at = now() where id = v.id;
    return jsonb_build_object('result', 'flagged', 'id', v.id);
  end if;
  if v.amount_kes is distinct from p_amount_kes then
    update public.vendor_applications set status = 'flagged', flag_reason = 'amount_mismatch',
           paid_at = now(), updated_at = now() where id = v.id;
    return jsonb_build_object('result', 'amount_mismatch', 'id', v.id);
  end if;
  update public.vendor_applications set status = 'paid', paid_at = now(), updated_at = now() where id = v.id;
  return jsonb_build_object('result', 'confirmed', 'id', v.id, 'reference_number', v.reference_number);
end; $$;

revoke all on function public.confirm_vendor_payment(text, numeric) from public, anon, authenticated;
grant execute on function public.confirm_vendor_payment(text, numeric) to service_role;
