-- Configure the NyamaFest fixed-size family-table platter packages.
-- Existing reservation/order rows and their line-item prices are left intact;
-- the old generic catalogue is hidden from new bookings.
do $$
declare
  v_event_id uuid;
  v_item_id uuid;
  v_type_id uuid;
  v_package record;
begin
  select id into v_event_id from public.events where slug = 'nyamafest' limit 1;
  if v_event_id is null then
    raise notice 'NyamaFest event not found; package catalog seed skipped';
    return;
  end if;

  update public.reservation_types
     set is_active = false
   where event_id = v_event_id and name in ('Single', 'Group', 'Family');

  update public.preorder_items
     set is_active = false
   where event_id = v_event_id and name in ('Single Plata', 'Mid Plata', 'Large Plata');

  for v_package in
    select * from (values
      ('Basic Family Table', 3, 'Basic Family Platter',
       '1 kg goat + 1 kg chicken. All goat meat is roasted.', 1990::numeric, 2450::numeric, 0),
      ('Moderate Family Table', 7, 'Moderate Family Platter',
       '2 kg goat + 2 kg chicken. All goat meat is roasted.', 3990::numeric, 4450::numeric, 1),
      ('Big Family Table', 10, 'Big Family Platter',
       '¼ goat + 3 whole chickens. All goat meat is roasted.', 7450::numeric, 7950::numeric, 2)
    ) as p(type_name, party_size, item_name, item_description, early_price, regular_price, sort_order)
  loop
    select id into v_item_id from public.preorder_items
     where event_id = v_event_id and name = v_package.item_name limit 1;

    if v_item_id is null then
      insert into public.preorder_items (
        event_id, name, description, price_kes, compare_at_price_kes,
        image_url, quantity_cap, max_per_reservation, position, is_active
      ) values (
        v_event_id, v_package.item_name, v_package.item_description,
        v_package.early_price, v_package.regular_price,
        null, null, 1, v_package.sort_order, true
      ) returning id into v_item_id;
    else
      update public.preorder_items set
        description = v_package.item_description,
        price_kes = v_package.early_price,
        compare_at_price_kes = v_package.regular_price,
        max_per_reservation = 1,
        position = v_package.sort_order,
        is_active = true
      where id = v_item_id;
    end if;

    select id into v_type_id from public.reservation_types
     where event_id = v_event_id and name = v_package.type_name limit 1;

    if v_type_id is null then
      insert into public.reservation_types (
        event_id, name, description, fixed_party_size, min_party_size,
        max_party_size, position, is_active, included_preorder_item_id
      ) values (
        v_event_id, v_package.type_name, v_package.party_size::text || ' people',
        v_package.party_size, 1, null, v_package.sort_order, true, v_item_id
      );
    else
      update public.reservation_types set
        description = v_package.party_size::text || ' people',
        fixed_party_size = v_package.party_size,
        min_party_size = 1,
        max_party_size = null,
        position = v_package.sort_order,
        is_active = true,
        included_preorder_item_id = v_item_id
      where id = v_type_id;
    end if;
  end loop;
end $$;
