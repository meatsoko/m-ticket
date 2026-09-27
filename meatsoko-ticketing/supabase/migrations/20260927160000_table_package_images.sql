-- Optional presentation/pricing metadata for table packages built from the
-- existing reservation_types + preorder_items catalogue.
alter table public.preorder_items
  add column if not exists image_url text,
  add column if not exists compare_at_price_kes numeric(10,2)
    check (compare_at_price_kes is null or compare_at_price_kes >= price_kes);

alter table public.reservation_types
  add column if not exists included_preorder_item_id uuid
    references public.preorder_items(id) on delete set null;

alter table public.reservation_types
  add constraint reservation_types_package_requires_fixed_size
  check (included_preorder_item_id is null or fixed_party_size is not null);

create index if not exists reservation_types_included_item_idx
  on public.reservation_types (included_preorder_item_id);
