-- Every 5 minutes, ask Paystack about recent unconfirmed MeatSoko payments.
--
-- The Paystack account is shared with the WooCommerce store at
-- assets.meatsoko.com, and Paystack allows one live webhook per account. That
-- webhook stays pointed at WooCommerce (moving it would break that store), so
-- supabase/functions/paystack-webhook never receives MeatSoko payments. Buyers
-- returning from Paystack are confirmed on the spot by the return pages; this job
-- catches the buyer who paid and closed the tab first. See
-- supabase/functions/paystack-reconcile/index.ts.
--
-- No key is stored: the function needs none (it can only confirm payments that
-- Paystack says succeeded, through the same idempotent paths as the return pages)
-- and it rate-limits itself. The URL below is the project's public functions URL.
--
-- Re-running is safe: an existing job of the same name is replaced.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'paystack-reconcile') then
    perform cron.unschedule('paystack-reconcile');
  end if;
end $$;

select cron.schedule(
  'paystack-reconcile',
  '*/5 * * * *',
  $job$
    select net.http_post(
      url := 'https://tyirenanflcmwfywurvk.supabase.co/functions/v1/paystack-reconcile',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $job$
);
