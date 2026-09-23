-- Let callers test a throttle without consuming budget.
--
-- stk-push previously incremented before doing any work, so an attempt that failed on a
-- bad event id or a sold-out type still burned the buyer's allowance — four mistyped
-- tries locked a real customer out for ten minutes. The harm being throttled is a
-- *delivered* M-Pesa PIN prompt, so the counter should move when Daraja accepts the
-- request, not when someone starts filling in a form. Abuse is still throttled: spraying
-- PIN prompts requires Daraja to accept each one.
create or replace function public.rate_limit_hit(
  p_bucket text, p_limit integer, p_window_seconds integer, p_increment boolean default true
) returns jsonb
language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_row public.rate_limits%rowtype;
  v_expired boolean;
begin
  if not p_increment then
    -- Read-only check. A bucket whose window has expired counts as zero.
    select * into v_row from public.rate_limits where bucket = p_bucket;
    if not found then
      return jsonb_build_object('allowed', true, 'hits', 0, 'retry_after', 0);
    end if;
    v_expired := v_row.window_start < now() - make_interval(secs => p_window_seconds);
    return jsonb_build_object(
      'allowed', v_expired or v_row.hits < p_limit,
      'hits', case when v_expired then 0 else v_row.hits end,
      'retry_after', case when v_expired then 0 else greatest(
        0, ceil(p_window_seconds - extract(epoch from (now() - v_row.window_start)))
      )::int end
    );
  end if;

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
      0, ceil(p_window_seconds - extract(epoch from (now() - v_row.window_start)))
    )::int
  );
end; $$;

-- Replaced by the 4-arg version; drop the old signature so PostgREST stops offering it.
drop function if exists public.rate_limit_hit(text, integer, integer);
