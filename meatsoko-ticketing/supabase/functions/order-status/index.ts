// Buyer-side payment polling. Body: { checkoutRequestId } or { reference }
import { json, preflight } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { nudgeOrder } from "../_shared/mpesa-order.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  const { checkoutRequestId, reference } = await req.json().catch(() => ({}));
  if (!checkoutRequestId && !reference) return json({ error: "missing_id" }, 400);

  const db = serviceClient();
  let { data: order } = await db.from("orders")
    .select("id,status")
    .eq(checkoutRequestId ? "mpesa_checkout_request_id" : "paystack_reference", checkoutRequestId ?? reference)
    .maybeSingle();
  if (!order) return json({ status: "unknown" });
  // An M-Pesa order still waiting: ask Safaricom now (its prompt is in the ledger).
  if (order.status === "pending" && checkoutRequestId) {
    await nudgeOrder(db, order.id);
    const { data: fresh } = await db.from("orders").select("id,status").eq("id", order.id).maybeSingle();
    if (fresh) order = fresh;
  }

  if (order.status !== "paid") return json({ status: order.status });

  const { data: tickets } = await db.from("tickets")
    .select("qr_token,status,ticket_types(name,bundle_qty)")
    .eq("order_id", order.id);
  return json({ status: "paid", tickets: tickets ?? [] });
});
