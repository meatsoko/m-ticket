// PayHero calls this when an STK payment finishes (callback_url set by payhero-pay).
//
// The callback is NOT signed, so its contents are never believed: it only tells
// us which of our payments to look at. verifyPayhero() then asks PayHero's
// transaction-status API, and only that answer confirms or fails anything. A
// forged callback can at most make us ask PayHero about a real reference early.
//
// Always answers 200 so PayHero doesn't retry forever; problems go to the logs,
// and payhero-reconcile catches anything missed.
import { json } from "../_shared/cors.ts";
import { rateLimit, serviceClient } from "../_shared/supabase.ts";
import { PAYHERO_REFERENCE, verifyPayhero } from "../_shared/payhero.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const body: any = await req.json().catch(() => null);
  const r = body?.response ?? body ?? {};
  const reference = String(r.ExternalReference ?? r.external_reference ?? "");
  if (!PAYHERO_REFERENCE.test(reference)) return json({ received: true, ignored: "reference" });

  const db = serviceClient();
  // Each check costs a PayHero API call: cap how often a callback can trigger one.
  const gate = await rateLimit(db, "payhero-callback:global", 300, 60);
  if (!gate.allowed) return json({ received: true, deferred: true });
  try {
    const out = await verifyPayhero(db, reference);
    console.log(JSON.stringify({ msg: "payhero callback", ref: reference.slice(0, 10), status: out.status, result: out.result ?? null }));
    return json({ received: true });
  } catch (e) {
    console.error(JSON.stringify({ msg: "payhero callback check failed", ref: reference.slice(0, 10), detail: String((e as Error)?.message ?? e).slice(0, 160) }));
    return json({ received: true });
  }
});
