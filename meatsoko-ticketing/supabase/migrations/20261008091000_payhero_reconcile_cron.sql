-- Every 2 minutes, ask PayHero about PayHero payments still queued (1 minute to
-- 3 hours old), in case the callback was lost or the payer closed the page.
-- See supabase/functions/payhero-reconcile/index.ts. No key is stored: the
-- function needs none and rate-limits itself. Re-running replaces the job.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'payhero-reconcile') then
    perform cron.unschedule('payhero-reconcile');
  end if;
end $$;

select cron.schedule(
  'payhero-reconcile',
  '*/2 * * * *',
  $job$
    select net.http_post(
      url := 'https://tyirenanflcmwfywurvk.supabase.co/functions/v1/payhero-reconcile',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $job$
);
