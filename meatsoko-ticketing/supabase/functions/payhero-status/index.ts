// The page waiting for the M-Pesa PIN polls this with its "PH…" reference
// (returned only to the payer by payhero-pay; 128-bit, unguessable).
// Body: { reference } -> { status: queued|success|failed, result?, kind, ... }
//
// While queued it asks PayHero directly (at most every few seconds per payment),
// so a lost callback doesn't leave the payer staring at a spinner.
import { json, preflight } from "../_shared/cors.ts";
import { clientIp, rateLimit, serviceClient } from "../_shared/supabase.ts";
import { PAYHERO_REFERENCE, loadLedger, verifyPayhero } from "../_shared/payhero.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const { reference } = await req.json().catch(() => ({}));
  if (typeof reference !== "string" || !PAYHERO_REFERENCE.test(reference)) return json({ error: "not_found" }, 404);
  const db = serviceClient();
  const byIp = await rateLimit(db, `payhero-status:ip:${clientIp(req)}`, 120, 600);
  if (!byIp.allowed) return json({ error: "rate_limited", retry_after: byIp.retryAfter }, 429);

  let row = await loadLedger(db, reference);
  if (!row) return json({ error: "not_found" }, 404);
  if (row.status === "queued" && Date.now() - Date.parse(row.created_at) > 8_000) {
    const ask = await rateLimit(db, `payhero-status:ref:${reference}`, 1, 4);
    if (ask.allowed) {
      try { await verifyPayhero(db, reference); }
      catch (e) { console.error(JSON.stringify({ msg: "payhero status check failed", ref: reference.slice(0, 10), detail: String(e).slice(0, 160) })); }
      row = (await loadLedger(db, reference)) ?? row;
    }
  }
  return json({ status: row.status, result: row.outcome, kind: row.kind, ...(await details(db, row)) });
});

/** What the page needs once paid: where to send the payer next. */
async function details(db: any, row: any) {
  if (row.status !== "success") return {};
  if (row.kind === "merch") {
    const { data } = await db.from("merch_orders").select("order_number,access_token").eq("id", row.merch_order_id).maybeSingle();
    return data ? { order_number: data.order_number, access_token: data.access_token } : {};
  }
  if (row.kind === "vendor") {
    const { data } = await db.from("vendor_applications").select("reference_number").eq("id", row.vendor_application_id).maybeSingle();
    return data ? { reference_number: data.reference_number } : {};
  }
  return {};
}
