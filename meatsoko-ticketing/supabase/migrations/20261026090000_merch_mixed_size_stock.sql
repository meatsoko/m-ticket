-- Real stock without changing the website: mixed-sizes buckets, test orders.
--
-- WHY (2026-10-25)
-- The organiser's stock sheet counts each product, not each size, and the website
-- must keep its prices and availability exactly as they are. Tracking a size the
-- shop sells would change the shop (a tracked size limits checkout; 0 shows "Sold
-- out"). So the real counts go into a hidden per-product "Mixed sizes" variant —
-- a BUCKET: inactive (never shown or sold online), flagged is_bucket — and every
-- size the shop sells stays untracked, so the storefront is unchanged.
--
-- WHERE A SALE COMES OFF: merch_stock_target(variant)
--   1. the size itself, when it is tracked (as before);
--   2. else the product's tracked bucket;
--   3. else the tracked bucket of merch_products.stock_product_id — set when two
--      listings are one physical item (the two Hustle Game 21 hoodie listings).
--      Deliberately explicit: style_key also groups different colourways (a white
--      polo must never come off the red polo's count).
--   4. else nothing: an untracked piece, recorded without moving stock.
--
-- NEGATIVE BUCKETS
-- The website still sells without limit, so a paid web order may take a bucket
-- below zero: units sold online that are not on the shelf ("owed"). That is
-- recorded, never refused — refusing would leave a paid order flagged for a
-- refund, which the unchanged storefront could not have warned about. Only
-- buckets may go negative (merch_variants check). Stand sales, removals and
-- exchanges stay strict: they cannot hand over what is not there.
--
-- TEST ORDERS
-- merch_orders.is_test keeps test purchases (the KSh 10 beanie, MS-FEADKS) out of
-- sales lines, reports and the Overview; they take no returns.
--
-- Function bodies below are those of 20261025100000 with the stock target swapped
-- in; behaviour for tracked sizes is unchanged.

alter table public.merch_variants add column if not exists is_bucket boolean not null default false;
alter table public.merch_variants drop constraint if exists merch_variants_stock_on_hand_check;
alter table public.merch_variants
  add constraint merch_variants_stock_on_hand_check check (stock_on_hand is null or stock_on_hand >= 0 or is_bucket);
-- A bucket is never on the shop.
alter table public.merch_variants add constraint merch_variants_bucket_hidden check (not is_bucket or not is_active);
create unique index if not exists merch_variants_one_bucket_idx on public.merch_variants (product_id) where is_bucket;

alter table public.merch_products
  add column if not exists stock_product_id uuid references public.merch_products(id)
    check (stock_product_id is null or stock_product_id <> id);

alter table public.merch_orders add column if not exists is_test boolean not null default false;

-- ---------------------------------------------------------------------------
create or replace function public.merch_stock_target(p_variant_id uuid)
returns uuid
language sql stable security definer
set search_path = public as $$
  select coalesce(
    (select v.id from public.merch_variants v where v.id = p_variant_id and v.stock_on_hand is not null),
    (select b.id from public.merch_variants v
       join public.merch_variants b on b.product_id = v.product_id and b.is_bucket and b.stock_on_hand is not null
      where v.id = p_variant_id),
    (select b.id from public.merch_variants v
       join public.merch_products p on p.id = v.product_id
       join public.merch_variants b on b.product_id = p.stock_product_id and b.is_bucket and b.stock_on_hand is not null
      where v.id = p_variant_id));
$$;

-- A paid website order takes its stock. A tracked size that has run out still
-- flags the order (as before); a bucket is never refused and may go negative.
create or replace function public.merch_take_order_stock(p_order_id uuid)
returns text
language plpgsql security definer
set search_path = public as $$
declare v_item record;
begin
  perform 1 from public.merch_variants
   where id in (select variant_id from public.merch_order_items where order_id = p_order_id
                union select public.merch_stock_target(variant_id) from public.merch_order_items where order_id = p_order_id)
   order by id for update;
  for v_item in
    select i.sku from public.merch_order_items i join public.merch_variants v on v.id = i.variant_id
     where i.order_id = p_order_id and v.stock_on_hand is not null and v.stock_on_hand < i.qty
     order by i.sku limit 1
  loop
    return v_item.sku;
  end loop;
  for v_item in
    select i.variant_id, i.qty, i.size, public.merch_stock_target(i.variant_id) as target
      from public.merch_order_items i
     where i.order_id = p_order_id
     order by i.variant_id
  loop
    if v_item.target is not null then
      perform public.merch_move_stock(v_item.target, -v_item.qty, 'sale', p_order_id => p_order_id,
                                      p_note => case when v_item.target <> v_item.variant_id then 'Website sale, size ' || v_item.size end);
    end if;
  end loop;
  return null;
end; $$;

-- Voiding puts back exactly what the sale took, where it took it from.
create or replace function public.merch_void_sale_internal(p_sale_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = public as $$
declare v_mv record;
begin
  perform 1 from public.merch_variants
   where id in (select variant_id from public.merch_stock_movements where manual_sale_id = p_sale_id and reason = 'manual_sale')
   order by id for update;
  for v_mv in
    select variant_id, delta from public.merch_stock_movements
     where manual_sale_id = p_sale_id and reason = 'manual_sale' order by variant_id
  loop
    perform public.merch_move_stock(v_mv.variant_id, -v_mv.delta, 'manual_sale_void',
                                    p_manual_sale_id => p_sale_id, p_note => p_reason);
  end loop;
  perform set_config('merch.ledger_write', 'on', true);
  update public.merch_manual_sales
     set status = 'voided', void_reason = btrim(p_reason), voided_by = auth.uid(), voided_at = now()
   where id = p_sale_id;
  perform set_config('merch.ledger_write', 'off', true);
end; $$;

create or replace function public.merch_record_manual_sale(p_sale jsonb)
returns jsonb
language plpgsql security definer
set search_path = public as $$
declare
  v_method  text := lower(btrim(coalesce(p_sale->>'payment_method', '')));
  v_code    text := nullif(upper(regexp_replace(coalesce(p_sale->>'mpesa_code', ''), '\s', '', 'g')), '');
  v_sold_at timestamptz;
  v_event   uuid;
  v_old     public.merch_manual_sales%rowtype;
  v_req     jsonb;
  v_bad     jsonb;
  v_sale    public.merch_manual_sales%rowtype;
  v_line    record;
begin
  if not public.is_admin() then return jsonb_build_object('result', 'forbidden'); end if;
  if p_sale is null or jsonb_typeof(p_sale) <> 'object' then return jsonb_build_object('result', 'bad_request'); end if;
  if v_method not in ('cash', 'mpesa', 'card', 'other') then return jsonb_build_object('result', 'bad_payment_method'); end if;
  if v_method = 'mpesa' and (v_code is null or v_code !~ '^[A-Z0-9]{10}$') then
    return jsonb_build_object('result', 'mpesa_code_required');
  end if;
  if v_method <> 'mpesa' then v_code := null; end if;
  if length(coalesce(p_sale->>'payment_ref', '')) > 80 or length(coalesce(p_sale->>'buyer_name', '')) > 120
     or length(coalesce(p_sale->>'location', '')) > 120 or length(coalesce(p_sale->>'note', '')) > 500 then
    return jsonb_build_object('result', 'too_long');
  end if;
  begin
    v_sold_at := coalesce(nullif(p_sale->>'sold_at', '')::timestamptz, now());
    v_event := nullif(p_sale->>'event_id', '')::uuid;
  exception when others then
    return jsonb_build_object('result', 'bad_request');
  end;
  if v_sold_at > now() + interval '5 minutes' or v_sold_at < now() - interval '90 days' then
    return jsonb_build_object('result', 'bad_sold_at');
  end if;
  if v_event is not null and not exists (select 1 from public.events where id = v_event) then
    return jsonb_build_object('result', 'unknown_event');
  end if;

  begin
    select jsonb_agg(to_jsonb(r)) into v_req
      from jsonb_to_recordset(p_sale->'lines') r(variant_id uuid, qty int, unit_price_kes numeric);
  exception when others then
    return jsonb_build_object('result', 'bad_lines');
  end;
  if v_req is null or jsonb_array_length(v_req) = 0 or jsonb_array_length(v_req) > 50
     or exists (select 1 from jsonb_to_recordset(v_req) r(variant_id uuid, qty int, unit_price_kes numeric)
                 where r.variant_id is null or r.qty is null or r.qty not between 1 and 100
                    or r.unit_price_kes is null or r.unit_price_kes <= 0 or r.unit_price_kes > 1000000
                    or r.unit_price_kes <> round(r.unit_price_kes, 2))
     or exists (select 1 from jsonb_to_recordset(v_req) r(variant_id uuid) group by r.variant_id having count(*) > 1) then
    return jsonb_build_object('result', 'bad_lines');
  end if;
  if exists (select 1 from jsonb_to_recordset(v_req) r(variant_id uuid)
              where not exists (select 1 from public.merch_variants v where v.id = r.variant_id)) then
    return jsonb_build_object('result', 'unknown_variant');
  end if;

  -- A correction voids the sale it replaces first, so its stock is free again.
  if p_sale ? 'replaces_sale_id' and nullif(p_sale->>'replaces_sale_id', '') is not null then
    begin
      select * into v_old from public.merch_manual_sales where id = (p_sale->>'replaces_sale_id')::uuid for update;
    exception when others then
      return jsonb_build_object('result', 'bad_request');
    end;
    if v_old.id is null then return jsonb_build_object('result', 'not_found'); end if;
    if v_old.status <> 'recorded' then return jsonb_build_object('result', 'already_voided'); end if;
    if exists (select 1 from public.merch_returns where manual_sale_id = v_old.id) then
      return jsonb_build_object('result', 'has_returns');
    end if;
    if coalesce(btrim(p_sale->>'void_reason'), '') = '' then return jsonb_build_object('result', 'void_reason_required'); end if;
    perform public.merch_void_sale_internal(v_old.id, p_sale->>'void_reason');
  end if;

  if v_code is not null and exists (select 1 from public.merch_manual_sales where mpesa_code = v_code and status = 'recorded') then
    raise exception using errcode = 'P0001', message = 'mpesa_code_used';
  end if;

  perform 1 from public.merch_variants
   where id in (select r.variant_id from jsonb_to_recordset(v_req) r(variant_id uuid)
                union select public.merch_stock_target(r.variant_id) from jsonb_to_recordset(v_req) r(variant_id uuid))
   order by id for update;
  -- The stand can't sell what isn't there, nor what a web buyer is paying for:
  -- per stock line (a size, or the mixed-sizes bucket several sizes share), on
  -- hand minus held must cover every unit this sale takes from it.
  select jsonb_agg(jsonb_build_object('sku', t.sku, 'available', t.free) order by t.sku) into v_bad
    from (select tv.sku, greatest(0, tv.stock_on_hand - public.merch_held_qty(tv.id)) as free, sum(r.qty) as qty
            from jsonb_to_recordset(v_req) r(variant_id uuid, qty int)
            join public.merch_variants tv on tv.id = public.merch_stock_target(r.variant_id)
           group by tv.id, tv.sku, tv.stock_on_hand) t
   where t.qty > t.free;
  if v_bad is not null then
    raise exception using errcode = 'P0001', message = 'insufficient', detail = v_bad::text;
  end if;

  insert into public.merch_manual_sales
    (sale_number, sold_at, payment_method, mpesa_code, payment_ref, buyer_name, location, event_id, note,
     subtotal_kes, replaces_sale_id, created_by)
  values (public.merch_gen_number('MM', 'public.merch_manual_sales', 'sale_number'), v_sold_at, v_method, v_code,
          nullif(btrim(coalesce(p_sale->>'payment_ref', '')), ''), nullif(btrim(coalesce(p_sale->>'buyer_name', '')), ''),
          nullif(btrim(coalesce(p_sale->>'location', '')), ''), v_event, nullif(btrim(coalesce(p_sale->>'note', '')), ''),
          (select sum(r.qty * r.unit_price_kes) from jsonb_to_recordset(v_req) r(qty int, unit_price_kes numeric)),
          v_old.id, auth.uid())
  returning * into v_sale;

  for v_line in
    select r.variant_id, r.qty, r.unit_price_kes, v.sku, v.size, public.merch_stock_target(r.variant_id) as target, p.name, p.color
      from jsonb_to_recordset(v_req) r(variant_id uuid, qty int, unit_price_kes numeric)
      join public.merch_variants v on v.id = r.variant_id
      join public.merch_products p on p.id = v.product_id
     order by r.variant_id
  loop
    insert into public.merch_manual_sale_items
      (sale_id, variant_id, product_name, color, size, sku, qty, unit_price_kes, stock_tracked)
    values (v_sale.id, v_line.variant_id, v_line.name, v_line.color, v_line.size, v_line.sku, v_line.qty,
            v_line.unit_price_kes, v_line.target is not null);
    if v_line.target is not null then
      perform public.merch_move_stock(v_line.target, -v_line.qty, 'manual_sale', p_manual_sale_id => v_sale.id,
                                      p_note => case when v_line.target <> v_line.variant_id then 'Size ' || v_line.size end);
    end if;
  end loop;

  insert into public.admin_audit (actor, action, subject_id, detail)
  values (auth.uid(), case when v_old.id is null then 'merch_manual_sale' else 'merch_manual_sale_correct' end, v_sale.id,
          jsonb_build_object('sale_number', v_sale.sale_number, 'total_kes', v_sale.subtotal_kes,
                             'payment_method', v_method, 'replaces', v_old.sale_number));
  return jsonb_build_object('result', 'recorded', 'sale_id', v_sale.id, 'sale_number', v_sale.sale_number,
                            'total_kes', v_sale.subtotal_kes, 'voided', v_old.sale_number);
exception
  -- Refusals found after the correction's void: raise so the void rolls back too.
  when sqlstate 'P0001' then
    if sqlerrm = 'insufficient' then
      declare v_detail text;
      begin
        get stacked diagnostics v_detail = pg_exception_detail;
        return jsonb_build_object('result', 'insufficient', 'lines', v_detail::jsonb);
      end;
    elsif sqlerrm = 'mpesa_code_used' then
      return jsonb_build_object('result', 'mpesa_code_used');
    end if;
    raise;
  when unique_violation then
    return jsonb_build_object('result', 'mpesa_code_used');
end; $$;

create or replace function public.merch_apply_return(p jsonb)
returns jsonb
language plpgsql security definer
set search_path = public as $$
declare
  v_source   text := p->>'source';
  v_reason   text := btrim(coalesce(p->>'reason', ''));
  v_order    public.merch_orders%rowtype;
  v_sale     public.merch_manual_sales%rowtype;
  v_lines    jsonb;
  v_exch     jsonb;
  v_del      numeric;
  v_extra    numeric;
  v_rmethod  text := nullif(lower(btrim(coalesce(p->>'refund_method', ''))), '');
  v_xmethod  text := nullif(lower(btrim(coalesce(p->>'extra_method', ''))), '');
  v_total    numeric;
  v_sale_total numeric;
  v_refunded numeric;
  v_bad      jsonb;
  v_ret      public.merch_returns%rowtype;
  v_line     record;
  v_restocked int := 0;
  v_exchanged int := 0;
begin
  if v_reason = '' or length(v_reason) > 500 then return jsonb_build_object('result', 'reason_required'); end if;
  if v_source is null or v_source not in ('web', 'manual') then return jsonb_build_object('result', 'bad_source'); end if;
  if length(coalesce(p->>'refund_ref', '')) > 80 or length(coalesce(p->>'extra_ref', '')) > 80 then
    return jsonb_build_object('result', 'too_long');
  end if;

  begin
    if v_source = 'web' then
      select * into v_order from public.merch_orders where id = (p->>'order_id')::uuid for update;
    else
      select * into v_sale from public.merch_manual_sales where id = (p->>'sale_id')::uuid for update;
    end if;
    select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_lines
      from jsonb_to_recordset(coalesce(p->'lines', '[]'::jsonb)) r(item_id uuid, qty int, refund_kes numeric, restock boolean);
    select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_exch
      from jsonb_to_recordset(coalesce(p->'exchange', '[]'::jsonb)) r(variant_id uuid, qty int);
    v_del := coalesce(nullif(p->>'delivery_refund_kes', '')::numeric, 0);
    v_extra := coalesce(nullif(p->>'extra_paid_kes', '')::numeric, 0);
  exception when others then
    return jsonb_build_object('result', 'bad_lines');
  end;

  if v_source = 'web' then
    if v_order.id is null then return jsonb_build_object('result', 'not_found'); end if;
    if v_order.payment_status <> 'paid' then
      return jsonb_build_object('result', 'not_returnable', 'status', v_order.payment_status);
    end if;
    if v_order.is_test then return jsonb_build_object('result', 'not_returnable', 'status', 'test'); end if;
    v_sale_total := v_order.total_kes; v_refunded := v_order.refunded_kes;
  else
    if v_sale.id is null then return jsonb_build_object('result', 'not_found'); end if;
    if v_sale.status <> 'recorded' then return jsonb_build_object('result', 'not_returnable', 'status', v_sale.status); end if;
    if v_del <> 0 then return jsonb_build_object('result', 'bad_lines', 'detail', 'no delivery on a manual sale'); end if;
    v_sale_total := v_sale.subtotal_kes; v_refunded := v_sale.refunded_kes;
  end if;

  if jsonb_array_length(v_lines) > 50 or jsonb_array_length(v_exch) > 20
     or (jsonb_array_length(v_lines) = 0 and jsonb_array_length(v_exch) = 0 and v_del = 0)
     or v_del < 0 or v_del <> round(v_del, 2) or v_extra < 0 or v_extra <> round(v_extra, 2)
     or exists (select 1 from jsonb_to_recordset(v_lines) r(item_id uuid, qty int, refund_kes numeric)
                 where r.item_id is null or coalesce(r.qty, -1) not between 0 and 100
                    or coalesce(r.refund_kes, -1) < 0 or r.refund_kes <> round(r.refund_kes, 2)
                    or (r.qty = 0 and r.refund_kes = 0))
     or exists (select 1 from jsonb_to_recordset(v_lines) r(item_id uuid) group by r.item_id having count(*) > 1)
     or exists (select 1 from jsonb_to_recordset(v_exch) r(variant_id uuid, qty int)
                 where r.variant_id is null or coalesce(r.qty, 0) not between 1 and 100
                    or not exists (select 1 from public.merch_variants v where v.id = r.variant_id))
     or exists (select 1 from jsonb_to_recordset(v_exch) r(variant_id uuid) group by r.variant_id having count(*) > 1) then
    return jsonb_build_object('result', 'bad_lines');
  end if;

  -- Each line must be an item of this sale, within what is left to return/refund.
  with item as (
    select i.id, i.variant_id, i.qty, i.line_total_kes from public.merch_order_items i
     where v_source = 'web' and i.order_id = v_order.id
    union all
    select i.id, i.variant_id, i.qty, i.line_total_kes from public.merch_manual_sale_items i
     where v_source = 'manual' and i.sale_id = v_sale.id
  ), done as (
    select coalesce(l.order_item_id, l.manual_sale_item_id) as item_id, sum(l.qty) as qty, sum(l.refund_kes) as refund
      from public.merch_return_lines l where l.direction = 'in'
       and coalesce(l.order_item_id, l.manual_sale_item_id) in (select id from item)
     group by 1
  )
  select jsonb_agg(jsonb_build_object('item_id', r.item_id,
           'qty_left', coalesce(item.qty - coalesce(done.qty, 0), 0),
           'refund_left', coalesce(item.line_total_kes - coalesce(done.refund, 0), 0)))
    into v_bad
    from jsonb_to_recordset(v_lines) r(item_id uuid, qty int, refund_kes numeric)
    left join item on item.id = r.item_id
    left join done on done.item_id = r.item_id
   where item.id is null or r.qty > item.qty - coalesce(done.qty, 0)
      or r.refund_kes > item.line_total_kes - coalesce(done.refund, 0);
  if v_bad is not null then return jsonb_build_object('result', 'exceeds_sold', 'lines', v_bad); end if;

  if v_source = 'web' and v_del > v_order.delivery_fee_kes - coalesce(
       (select sum(delivery_refund_kes) from public.merch_returns where merch_order_id = v_order.id), 0) then
    return jsonb_build_object('result', 'exceeds_delivery');
  end if;
  v_total := v_del + coalesce((select sum(r.refund_kes) from jsonb_to_recordset(v_lines) r(refund_kes numeric)), 0);
  if v_refunded + v_total > v_sale_total then
    return jsonb_build_object('result', 'exceeds_total', 'refundable', v_sale_total - v_refunded);
  end if;
  if v_total > 0 and (v_rmethod is null or v_rmethod not in ('paystack', 'mpesa', 'cash', 'card', 'other')) then
    return jsonb_build_object('result', 'refund_method_required');
  end if;
  if v_extra > 0 and (v_xmethod is null or v_xmethod not in ('cash', 'mpesa', 'card', 'other')) then
    return jsonb_build_object('result', 'extra_method_required');
  end if;

  -- Lock every size this touches, then check exchange stock: on hand minus web
  -- holds, plus whatever this same return puts back on the shelf.
  perform 1 from public.merch_variants
   where id in (select s.id from (
                  select r.variant_id as id from jsonb_to_recordset(v_exch) r(variant_id uuid)
                  union select public.merch_stock_target(r.variant_id) from jsonb_to_recordset(v_exch) r(variant_id uuid)
                  union select coalesce(oi.variant_id, si.variant_id) from jsonb_to_recordset(v_lines) r(item_id uuid)
                    left join public.merch_order_items oi on oi.id = r.item_id
                    left join public.merch_manual_sale_items si on si.id = r.item_id
                  union select public.merch_stock_target(coalesce(oi.variant_id, si.variant_id)) from jsonb_to_recordset(v_lines) r(item_id uuid)
                    left join public.merch_order_items oi on oi.id = r.item_id
                    left join public.merch_manual_sale_items si on si.id = r.item_id) s
                 where s.id is not null)
   order by id for update;
  -- Per stock line (size or mixed-sizes bucket): what the exchange hands over must
  -- fit in on hand minus web holds, plus what this same return puts back there.
  with outq as (
    select public.merch_stock_target(x.variant_id) as t, sum(x.qty) as qty
      from jsonb_to_recordset(v_exch) x(variant_id uuid, qty int) group by 1
  ), backq as (
    select public.merch_stock_target(coalesce(oi.variant_id, si.variant_id)) as t, sum(r.qty) as qty
      from jsonb_to_recordset(v_lines) r(item_id uuid, qty int, restock boolean)
      left join public.merch_order_items oi on oi.id = r.item_id
      left join public.merch_manual_sale_items si on si.id = r.item_id
     where coalesce(r.restock, false) group by 1
  )
  select jsonb_agg(jsonb_build_object('sku', v.sku, 'available', greatest(0, v.stock_on_hand - public.merch_held_qty(v.id))) order by v.sku)
    into v_bad
    from outq join public.merch_variants v on v.id = outq.t
    left join backq on backq.t = outq.t
   where v.stock_on_hand - public.merch_held_qty(v.id) + coalesce(backq.qty, 0) < outq.qty;
  if v_bad is not null then return jsonb_build_object('result', 'insufficient', 'lines', v_bad); end if;

  insert into public.merch_returns
    (return_number, source, merch_order_id, manual_sale_id, reason, refund_kes, delivery_refund_kes,
     refund_method, refund_ref, extra_paid_kes, extra_method, extra_ref, created_by)
  values (public.merch_gen_number('MR', 'public.merch_returns', 'return_number'), v_source, v_order.id, v_sale.id,
          v_reason, v_total, v_del, case when v_total > 0 then v_rmethod end,
          nullif(btrim(coalesce(p->>'refund_ref', '')), ''), v_extra,
          case when v_extra > 0 then v_xmethod end, nullif(btrim(coalesce(p->>'extra_ref', '')), ''), auth.uid())
  returning * into v_ret;

  for v_line in
    select r.item_id, r.qty, r.refund_kes, coalesce(r.restock, false) as restock,
           coalesce(oi.variant_id, si.variant_id) as variant_id,
           coalesce(oi.product_name, si.product_name) as product_name, coalesce(oi.color, si.color) as color,
           coalesce(oi.size, si.size) as size, coalesce(oi.sku, si.sku) as sku,
           public.merch_stock_target(coalesce(oi.variant_id, si.variant_id)) as target,
           oi.id as order_item_id, si.id as sale_item_id
      from jsonb_to_recordset(v_lines) r(item_id uuid, qty int, refund_kes numeric, restock boolean)
      left join public.merch_order_items oi on v_source = 'web' and oi.id = r.item_id
      left join public.merch_manual_sale_items si on v_source = 'manual' and si.id = r.item_id
      join public.merch_variants v on v.id = coalesce(oi.variant_id, si.variant_id)
     order by 6
  loop
    -- Goods go back on the shelf only when they came back, the admin says they can
    -- be sold again, and there is a count to add them to (the size, or its bucket).
    insert into public.merch_return_lines
      (return_id, direction, order_item_id, manual_sale_item_id, variant_id, product_name, color, size, sku,
       qty, refund_kes, stock_moved)
    values (v_ret.id, 'in', v_line.order_item_id, v_line.sale_item_id, v_line.variant_id, v_line.product_name,
            v_line.color, v_line.size, v_line.sku, v_line.qty, v_line.refund_kes,
            v_line.restock and v_line.qty > 0 and v_line.target is not null);
    if v_line.restock and v_line.qty > 0 and v_line.target is not null then
      perform public.merch_move_stock(v_line.target, v_line.qty, 'return', p_return_id => v_ret.id,
                                      p_note => v_reason || case when v_line.target <> v_line.variant_id then ' (size ' || v_line.size || ')' else '' end,
                                      p_order_id => case when v_source = 'web' then v_order.id end,
                                      p_manual_sale_id => case when v_source = 'manual' then v_sale.id end);
      v_restocked := v_restocked + v_line.qty;
    end if;
  end loop;

  for v_line in
    select x.variant_id, x.qty, v.sku, v.size, public.merch_stock_target(x.variant_id) as target, pr.name, pr.color
      from jsonb_to_recordset(v_exch) x(variant_id uuid, qty int)
      join public.merch_variants v on v.id = x.variant_id
      join public.merch_products pr on pr.id = v.product_id
     order by x.variant_id
  loop
    insert into public.merch_return_lines
      (return_id, direction, variant_id, product_name, color, size, sku, qty, stock_moved)
    values (v_ret.id, 'out', v_line.variant_id, v_line.name, v_line.color, v_line.size, v_line.sku, v_line.qty, v_line.target is not null);
    if v_line.target is not null then
      perform public.merch_move_stock(v_line.target, -v_line.qty, 'exchange_out', p_return_id => v_ret.id,
                                      p_note => v_reason || case when v_line.target <> v_line.variant_id then ' (size ' || v_line.size || ')' else '' end,
                                      p_order_id => case when v_source = 'web' then v_order.id end,
                                      p_manual_sale_id => case when v_source = 'manual' then v_sale.id end);
    end if;
    v_exchanged := v_exchanged + v_line.qty;
  end loop;

  if v_source = 'web' then
    update public.merch_orders
       set refunded_kes = refunded_kes + v_total,
           payment_status = case when refunded_kes + v_total >= total_kes then 'refunded' else payment_status end,
           refunded_at = case when refunded_kes + v_total >= total_kes then now() else refunded_at end,
           refund_reason = case when refunded_kes + v_total >= total_kes then v_reason else refund_reason end,
           refund_ref = case when refunded_kes + v_total >= total_kes then v_ret.refund_ref else refund_ref end,
           refunded_by = case when refunded_kes + v_total >= total_kes then auth.uid() else refunded_by end,
           fulfilment_status = case when refunded_kes + v_total >= total_kes
                                     and fulfilment_status in ('unfulfilled', 'packed', 'ready_for_pickup')
                                    then 'cancelled' else fulfilment_status end
     where id = v_order.id;
  elsif v_total > 0 then
    perform set_config('merch.ledger_write', 'on', true);
    update public.merch_manual_sales set refunded_kes = refunded_kes + v_total where id = v_sale.id;
    perform set_config('merch.ledger_write', 'off', true);
  end if;

  insert into public.admin_audit (actor, action, subject_id, detail)
  values (auth.uid(), 'merch_return', v_ret.id, jsonb_build_object(
    'return_number', v_ret.return_number, 'source', v_source,
    'sale', coalesce(v_order.order_number, v_sale.sale_number), 'refund_kes', v_total,
    'restocked_units', v_restocked, 'exchanged_units', v_exchanged, 'reason', v_reason));
  return jsonb_build_object('result', 'recorded', 'return_id', v_ret.id, 'return_number', v_ret.return_number,
                            'refund_kes', v_total, 'restocked_units', v_restocked, 'exchanged_units', v_exchanged);
end; $$;

create or replace function public.merch_sales_lines(
  p_from timestamptz default null, p_to timestamptz default null,
  p_source text default null, p_product_id uuid default null
) returns table (
  kind text, source text, ref text, occurred_at timestamptz, product_id uuid, variant_id uuid,
  product_name text, color text, size text, sku text, qty integer, amount_kes numeric,
  payment_method text, stock_tracked boolean
)
language plpgsql stable security definer
set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'merch_sales_lines: admins only' using errcode = '42501';
  end if;
  return query
  with web as (
    select o.id, o.order_number, o.paid_at, o.refunded_at, o.delivery_fee_kes, o.total_kes,
           case when o.paystack_reference is null then 'mpesa' else 'paystack' end as method
      from public.merch_orders o where o.paid_at is not null and not o.is_test
  ), lines as (
    select 'sale'::text as kind, 'web'::text as source, w.order_number as ref, w.paid_at as occurred_at,
           v.product_id, i.variant_id, i.product_name, i.color, i.size, i.sku, i.qty,
           i.line_total_kes::numeric as amount_kes, w.method as payment_method,
           exists (select 1 from public.merch_stock_movements m join public.merch_variants mv on mv.id = m.variant_id
                    where m.order_id = w.id and m.reason = 'sale'
                      and (m.variant_id = i.variant_id
                           or (mv.is_bucket and mv.product_id in (v.product_id,
                                 (select pp.stock_product_id from public.merch_products pp where pp.id = v.product_id))))) as stock_tracked
      from web w join public.merch_order_items i on i.order_id = w.id
      join public.merch_variants v on v.id = i.variant_id
    union all
    select 'delivery', 'web', w.order_number, w.paid_at, null::uuid, null::uuid, 'Delivery', null::text, null::text,
           null::text, 0, w.delivery_fee_kes::numeric, w.method, null::boolean
      from web w where w.delivery_fee_kes > 0
    union all
    select 'refund', 'web', w.order_number, w.refunded_at, null::uuid, null::uuid, 'Refund (whole order)', null::text,
           null::text, null::text, 0, -w.total_kes::numeric, w.method, null::boolean
      from web w
     where w.refunded_at is not null
       and not exists (select 1 from public.merch_returns r where r.merch_order_id = w.id)
    union all
    select 'sale', 'manual', s.sale_number, s.sold_at, v.product_id, i.variant_id, i.product_name, i.color, i.size,
           i.sku, i.qty, i.line_total_kes::numeric, s.payment_method, i.stock_tracked
      from public.merch_manual_sales s join public.merch_manual_sale_items i on i.sale_id = s.id
      join public.merch_variants v on v.id = i.variant_id
     where s.status = 'recorded'
    union all
    select 'return', r.source, r.return_number, r.created_at, v.product_id, l.variant_id, l.product_name, l.color,
           l.size, l.sku, -l.qty, -l.refund_kes::numeric, r.refund_method, l.stock_moved
      from public.merch_returns r join public.merch_return_lines l on l.return_id = r.id and l.direction = 'in'
      join public.merch_variants v on v.id = l.variant_id
    union all
    select 'delivery_refund', 'web', r.return_number, r.created_at, null::uuid, null::uuid, 'Delivery refund',
           null::text, null::text, null::text, 0, -r.delivery_refund_kes::numeric, r.refund_method, null::boolean
      from public.merch_returns r where r.delivery_refund_kes > 0
    union all
    select 'exchange_out', r.source, r.return_number, r.created_at, v.product_id, l.variant_id, l.product_name,
           l.color, l.size, l.sku, l.qty, 0::numeric, null::text, l.stock_moved
      from public.merch_returns r join public.merch_return_lines l on l.return_id = r.id and l.direction = 'out'
      join public.merch_variants v on v.id = l.variant_id
    union all
    select 'exchange_topup', r.source, r.return_number, r.created_at, null::uuid, null::uuid, 'Exchange top-up',
           null::text, null::text, null::text, 0, r.extra_paid_kes::numeric, r.extra_method, null::boolean
      from public.merch_returns r where r.extra_paid_kes > 0
  )
  select l.kind, l.source, l.ref, l.occurred_at, l.product_id, l.variant_id, l.product_name, l.color, l.size, l.sku,
         l.qty, l.amount_kes, l.payment_method, l.stock_tracked
    from lines l
   where (p_from is null or l.occurred_at >= p_from) and (p_to is null or l.occurred_at < p_to)
     and (p_source is null or l.source = p_source)
     and (p_product_id is null or l.product_id = p_product_id)
   order by l.occurred_at, l.ref, l.sku nulls first;
end; $$;

-- ---------------------------------------------------------------------------
-- EXECUTE grants — unchanged for the replaced functions; restated explicitly.
-- ---------------------------------------------------------------------------
revoke all on function public.merch_stock_target(uuid) from public, anon, authenticated;
revoke all on function public.merch_take_order_stock(uuid) from public, anon, authenticated;
revoke all on function public.merch_void_sale_internal(uuid, text) from public, anon, authenticated;
revoke all on function public.merch_apply_return(jsonb) from public, anon, authenticated;
revoke all on function public.merch_record_manual_sale(jsonb) from public, anon, authenticated;
revoke all on function public.merch_sales_lines(timestamptz, timestamptz, text, uuid) from public, anon, authenticated;
grant execute on function public.merch_record_manual_sale(jsonb) to authenticated;
grant execute on function public.merch_sales_lines(timestamptz, timestamptz, text, uuid) to authenticated;
-- merch_stock_target, merch_take_order_stock, merch_void_sale_internal and
-- merch_apply_return stay internal: granted to nobody.
