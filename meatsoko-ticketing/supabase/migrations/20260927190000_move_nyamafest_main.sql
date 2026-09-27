-- Move the main NyamaFest listing to the October 17 date and carry forward the
-- September 27 event configuration and platter catalogue. Keep both event
-- identities and all historical orders/reservations attached to their event.
do $$
declare
  v_source_id uuid;
  v_target_id uuid;
begin
  select id into v_source_id from public.events where slug = 'nyamafest' limit 1;
  select id into v_target_id from public.events where slug = 'nyamafest-main' limit 1;

  if v_source_id is null or v_target_id is null then
    raise notice 'NyamaFest source or main event missing; event move skipped';
    return;
  end if;

  update public.events target set
    tagline = source.tagline,
    venue = 'Thika Greens Golf Course',
    description = source.description,
    banner_url = source.banner_url,
    starts_at = ((timestamp '2026-10-17 00:00:00' +
      (source.starts_at at time zone 'Africa/Nairobi')::time) at time zone 'Africa/Nairobi'),
    ends_at = ((timestamp '2026-10-17 00:00:00' +
      (source.ends_at at time zone 'Africa/Nairobi')::time) at time zone 'Africa/Nairobi'),
    doors_open_at = case when source.doors_open_at is null then null else
      ((timestamp '2026-10-17 00:00:00' +
        (source.doors_open_at at time zone 'Africa/Nairobi')::time) at time zone 'Africa/Nairobi') end,
    reservation_mode = source.reservation_mode,
    payments_enabled = source.payments_enabled,
    capacity = source.capacity,
    max_party_size = source.max_party_size,
    reservations_open_at = source.reservations_open_at,
    reservations_close_at = source.reservations_close_at,
    contact_phone = source.contact_phone,
    contact_email = source.contact_email,
    notify_email = source.notify_email,
    notify_whatsapp = source.notify_whatsapp
  from public.events source
  where target.id = v_target_id and source.id = v_source_id;

  -- Copy or refresh platter rows by name, retaining existing target item IDs
  -- where they already exist. This leaves target-side orders untouched.
  insert into public.preorder_items (
    event_id, name, description, price_kes, compare_at_price_kes, image_url,
    quantity_cap, max_per_reservation, position, is_active, early_bird_ends_at
  )
  select v_target_id, source.name, source.description, source.price_kes,
    source.compare_at_price_kes, source.image_url, source.quantity_cap,
    source.max_per_reservation, source.position, source.is_active,
    source.early_bird_ends_at
  from public.preorder_items source
  where source.event_id = v_source_id
    and not exists (
      select 1 from public.preorder_items target
      where target.event_id = v_target_id and target.name = source.name
    );

  update public.preorder_items target set
    description = source.description,
    price_kes = source.price_kes,
    compare_at_price_kes = source.compare_at_price_kes,
    image_url = source.image_url,
    quantity_cap = source.quantity_cap,
    max_per_reservation = source.max_per_reservation,
    position = source.position,
    is_active = source.is_active,
    early_bird_ends_at = source.early_bird_ends_at
  from public.preorder_items source
  where source.event_id = v_source_id and target.event_id = v_target_id
    and target.name = source.name;

  update public.reservation_types target set
    description = source.description,
    fixed_party_size = source.fixed_party_size,
    min_party_size = source.min_party_size,
    max_party_size = source.max_party_size,
    position = source.position,
    is_active = source.is_active,
    included_preorder_item_id = target_item.id
  from public.reservation_types source
  left join public.preorder_items source_item
    on source_item.id = source.included_preorder_item_id
  left join public.preorder_items target_item
    on target_item.event_id = v_target_id and target_item.name = source_item.name
  where source.event_id = v_source_id and target.event_id = v_target_id
    and target.name = source.name;

  insert into public.reservation_types (
    event_id, name, description, fixed_party_size, min_party_size,
    max_party_size, position, is_active, included_preorder_item_id
  )
  select v_target_id, source.name, source.description, source.fixed_party_size,
    source.min_party_size, source.max_party_size, source.position,
    source.is_active, target_item.id
  from public.reservation_types source
  left join public.preorder_items source_item
    on source_item.id = source.included_preorder_item_id
  left join public.preorder_items target_item
    on target_item.event_id = v_target_id and target_item.name = source_item.name
  where source.event_id = v_source_id
    and not exists (
      select 1 from public.reservation_types target
      where target.event_id = v_target_id and target.name = source.name
    );

  update public.events set status = 'closed' where id = v_source_id;
end $$;
