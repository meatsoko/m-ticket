// A merchandise order as its buyer sees it.
//
// Body: { reference } — the buyer has just come back from Paystack (the reference is
//                       on the callback URL). If the webhook has not confirmed the
//                       order yet, this verifies with Paystack itself; both paths are
//                       idempotent.
//    or { access_token } — the order page (/order/<token>), linked from the email.
//
// Both keys are 128-bit and unguessable, like pass tokens. The response carries no
// phone, email or address — only what the buyer needs to see their order.
import { json, preflight } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { MERCH_REFERENCE, verifyAndConfirmMerch } from "../_shared/merch.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const { reference, access_token } = await req.json().catch(() => ({}));

  const byReference = typeof reference === "string" && MERCH_REFERENCE.test(reference);
  const byToken = typeof access_token === "string" && /^[a-f0-9]{32}$/.test(access_token);
  if (!byReference && !byToken) return json({ error: "not_found" }, 404);

  const db = serviceClient();
  let verification: string | null = null;
  if (byReference) {
    try {
      const r: any = await verifyAndConfirmMerch(reference, db);
      verification = r?.result ?? null;
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      if (msg === "unknown_reference") return json({ error: "not_found" }, 404);
      // Paystack unreachable: still show the order as it stands; the webhook will catch up.
      verification = "unavailable";
      console.error("merch-order verify failed", msg);
    }
  }

  const { data: o } = await db.from("merch_orders")
    .select("order_number,access_token,first_name,payment_status,fulfilment_status,flag_reason,total_kes,subtotal_usd,delivery_fee_usd,total_usd,created_at,paid_at,dispatched_at,completed_at,delivery_code,delivery_town,merch_delivery_options(label,blurb),merch_order_items(product_name,color,size,sku,qty,unit_price_usd)")
    .eq(byReference ? "paystack_reference" : "access_token", byReference ? reference : access_token)
    .maybeSingle();
  if (!o) return json({ error: "not_found" }, 404);

  const opt: any = (o as any).merch_delivery_options;
  return json({
    order_number: o.order_number,
    access_token: o.access_token,
    first_name: o.first_name,
    payment_status: o.payment_status,
    // Flag details are for staff; the buyer only needs to know someone will be in touch.
    needs_attention: o.payment_status === "flagged",
    fulfilment_status: o.fulfilment_status,
    delivery: { code: o.delivery_code, label: opt?.label ?? o.delivery_code, blurb: opt?.blurb ?? null, town: o.delivery_town },
    items: (o as any).merch_order_items ?? [],
    // Prices are shown in USD; total_kes is what Paystack actually charged (for the receipt line).
    subtotal_usd: o.subtotal_usd,
    delivery_fee_usd: o.delivery_fee_usd,
    total_usd: o.total_usd,
    total_kes: o.total_kes,
    created_at: o.created_at,
    paid_at: o.paid_at,
    dispatched_at: o.dispatched_at,
    completed_at: o.completed_at,
    verification,
  });
});
