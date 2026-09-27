// Buyer-side payment polling. Body: { checkoutRequestId } or { reference }
import { json, preflight } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  const { checkoutRequestId, reference } = await req.json().catch(() => ({}));
  if (!checkoutRequestId && !reference) return json({ error: "missing_id" }, 400);

  const db = serviceClient();
  const { data: order } = await db.from("orders")
    .select("id,status")
    .eq(checkoutRequestId ? "mpesa_checkout_request_id" : "paystack_reference", checkoutRequestId ?? reference)
    .maybeSingle();
  if (!order) return json({ status: "unknown" });

  if (order.status !== "paid") return json({ status: order.status });

  const { data: tickets } = await db.from("tickets")
    .select("qr_token,status,ticket_types(name,bundle_qty)")
    .eq("order_id", order.id);
  return json({ status: "paid", tickets: tickets ?? [] });
});
