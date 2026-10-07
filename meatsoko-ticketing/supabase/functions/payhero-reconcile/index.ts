// Asks PayHero about PayHero payments nobody has settled yet (callback lost, page
// closed). Run by Supabase Cron every 2 minutes (migration
// 20261008091000_payhero_reconcile_cron.sql). Same idea as paystack-reconcile:
// no key needed — all it can do is run verifyPayhero(), which only confirms what
// PayHero itself reports — and a global rate limit keeps it from being a hammer.
import { json } from "../_shared/cors.ts";
import { rateLimit, serviceClient } from "../_shared/supabase.ts";
import { verifyPayhero } from "../_shared/payhero.ts";

const MIN_AGE_MS = 60 * 1000;            // give the payer time to enter the PIN
const MAX_AGE_MS = 3 * 60 * 60 * 1000;   // stop asking about long-dead prompts
const MAX_PER_RUN = 25;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const db = serviceClient();
  const gate = await rateLimit(db, "payhero-reconcile:global", 8, 600);
  if (!gate.allowed) return json({ error: "rate_limited", retry_after: gate.retryAfter }, 429);

  const { data, error } = await db.from("payhero_payments").select("reference")
    .eq("status", "queued").not("payhero_reference", "is", null)
    .gte("created_at", new Date(Date.now() - MAX_AGE_MS).toISOString())
    .lte("created_at", new Date(Date.now() - MIN_AGE_MS).toISOString())
    .order("created_at", { ascending: true }).limit(MAX_PER_RUN);
  if (error) return json({ error: "query_failed", detail: error.message }, 500);

  const outcome: Record<string, number> = {};
  for (const { reference } of data ?? []) {
    try {
      const r = await verifyPayhero(db, reference);
      const k = `${r.status}${r.result ? `:${r.result}` : ""}`;
      outcome[k] = (outcome[k] ?? 0) + 1;
    } catch (e) {
      outcome.error = (outcome.error ?? 0) + 1;
      console.error(JSON.stringify({ msg: "payhero reconcile check failed", ref: reference.slice(0, 10), detail: String((e as Error)?.message ?? e).slice(0, 160) }));
    }
  }
  return json({ checked: (data ?? []).length, outcome });
});
