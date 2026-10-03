-- TEST ONLY: create auth users for the dashboard test
create or replace function public.test_make_user(p_id uuid) returns void language sql security definer set search_path = public as $$ insert into auth.users (id) values (p_id) on conflict do nothing $$;
revoke all on function public.test_make_user(uuid) from public, anon, authenticated;
grant execute on function public.test_make_user(uuid) to service_role;
notify pgrst, 'reload schema';
