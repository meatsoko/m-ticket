// Platter add-ons (migration 20261001120000): an in-person attendee pre-orders
// family platters from their pass, collected at the event.
// Body: { access_token, items: [{ preorder_item_id, qty }] }
//
// The pass token is the only authorisation (same rule as table upgrades). The
// booking is untouched until Paystack confirms the money; an abandoned payment
// changes nothing. Online attendees have no pass token, so can't get here.
import { json, preflight } from "../_shared/cors.ts";
import { clientIp, rateLimit, serviceClient } from "../_shared/supabase.ts";
import { openOrderPayment } from "../_shared/paystack-order.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONFLICTS = new Set(["not_eligible", "event_not_live", "payments_unavailable", "closed", "preorder_sold_out"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const body = await req.json().catch(() => null);
  const token = String(body?.access_token ?? "");
  if (!/^[a-f0-9]{32}$/.test(token)) return json({ error: "not_found" }, 404);
  const items = Array.isArray(body?.items) ? body.items : null;
  if (!items || !items.length || items.length > 10 ||
      !items.every((i: any) => UUID.test(String(i?.preorder_item_id)) && Number.isInteger(i?.qty) && i.qty > 0)) {
    return json({ error: "bad_items" }, 400);
  }

  const db = serviceClient();
  const byIp = await rateLimit(db, `addon:ip:${clientIp(req)}`, 30, 600);
  if (!byIp.allowed) return json({ error: "rate_limited", retry_after: byIp.retryAfter }, 429);
  const byPass = await rateLimit(db, `addon:pass:${token}`, 6, 600);
  if (!byPass.allowed) return json({ error: "rate_limited", retry_after: byPass.retryAfter }, 429);

  const { data, error } = await db.rpc("start_platter_addon", {
    p_token: token, p_items: items.map((i: any) => ({ preorder_item_id: i.preorder_item_id, qty: i.qty })),
  });
  if (error) { console.error(JSON.stringify({ msg: "addon start failed", detail: error.message })); return json({ error: "addon_failed" }, 500); }
  const r: any = data;
  if (r?.result !== "created") {
    const code = r?.result ?? "addon_rejected";
    return json({ error: code, ...(r?.item ? { item: r.item } : {}), ...(r?.max ? { max: r.max } : {}) },
      code === "not_found" ? 404 : CONFLICTS.has(code) ? 409 : 400);
  }

  const paid = await openOrderPayment(db, req, {
    orderId: r.order_id, email: r.email, amountKes: Number(r.amount_kes), callbackPath: "/platters/complete",
    metadata: { order_id: r.order_id, reservation_id: r.reservation_id, kind: "platter_addon" },
    onFail: async () => { await db.from("reservation_addons").update({ status: "failed" }).eq("order_id", r.order_id); },
    logLabel: "addon",
  });
  if (!paid.ok) return json({ error: paid.error }, paid.status);
  console.log(JSON.stringify({ msg: "platter add-on started", number: r.reservation_number, lines: r.lines, amount: r.amount_kes }));
  return json({ reservation_number: r.reservation_number, amount_kes: Number(r.amount_kes),
    authorizationUrl: paid.authorizationUrl, accessCode: paid.accessCode, reference: paid.reference });
});
