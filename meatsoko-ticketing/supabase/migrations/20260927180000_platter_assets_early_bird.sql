alter table public.preorder_items
  add column if not exists early_bird_ends_at timestamptz;

-- Start the ten-day offer once, when this migration is applied. A rerun keeps
-- the original deadline so a deploy cannot restart the countdown.
update public.preorder_items pi set
  description = case pi.name
    when 'Basic Family Platter' then '1 kg roasted goat + 1 kg chicken. All goat meat is roasted.'
    when 'Moderate Family Platter' then '2 kg roasted goat + 2 kg chicken. All goat meat is roasted.'
    when 'Big Family Platter' then '¼ goat + 3 whole chickens. All goat meat is roasted.'
  end,
  image_url = case pi.name
    when 'Basic Family Platter' then '/images/table-packages/basic-family.webp'
    when 'Moderate Family Platter' then '/images/table-packages/moderate-family.webp'
    when 'Big Family Platter' then '/images/table-packages/big-family.webp'
  end,
  early_bird_ends_at = coalesce(pi.early_bird_ends_at, now() + interval '10 days')
from public.events e
where e.id = pi.event_id and e.slug = 'nyamafest'
  and pi.name in ('Basic Family Platter', 'Moderate Family Platter', 'Big Family Platter');

-- Apply the campaign's current price at checkout using database time. After
-- expiry, pending orders are repriced to the regular amount before payment is
-- initiated; paid orders retain their original line-item snapshot.
create or replace function public.reprice_pending_reservation_order(p_order_id uuid)
returns numeric
language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_status public.order_status;
  v_total numeric(10,2);
begin
  select status into v_status from public.orders where id = p_order_id for update;
  if not found or v_status <> 'pending' then
    raise exception 'order_not_pending';
  end if;

  update public.order_items oi set unit_price_kes =
    case
      when pi.early_bird_ends_at is not null and now() >= pi.early_bird_ends_at
        then coalesce(pi.compare_at_price_kes, pi.price_kes)
      else pi.price_kes
    end
  from public.preorder_items pi
  where oi.order_id = p_order_id and oi.preorder_item_id = pi.id;

  select coalesce(sum(qty * unit_price_kes), 0)::numeric(10,2)
    into v_total from public.order_items where order_id = p_order_id;
  update public.orders set amount_kes = v_total where id = p_order_id;
  return v_total;
end; $$;

revoke all on function public.reprice_pending_reservation_order(uuid) from public, anon, authenticated;
grant execute on function public.reprice_pending_reservation_order(uuid) to service_role;
