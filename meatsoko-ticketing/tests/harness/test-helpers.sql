-- TEST ONLY: create auth users for the dashboard test
create or replace function public.test_make_user(p_id uuid) returns void language sql security definer set search_path = public as $$ insert into auth.users (id) values (p_id) on conflict do nothing $$;
revoke all on function public.test_make_user(uuid) from public, anon, authenticated;
grant execute on function public.test_make_user(uuid) to service_role;
notify pgrst, 'reload schema';
-- TEST ONLY: the fake Auth admin API (vendor-invite) creates users by email; null if taken.
create or replace function public.test_make_auth_user(p_email text) returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if exists (select 1 from auth.users where lower(email) = lower(p_email)) then return null; end if;
  insert into auth.users (email) values (p_email) returning id into v;
  return v;
end; $$;
revoke all on function public.test_make_auth_user(text) from public, anon, authenticated;
grant execute on function public.test_make_auth_user(text) to service_role;
notify pgrst, 'reload schema';
