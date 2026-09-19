// FR-P1/P2, FR-G1: create pending order (+items, prices from DB) and trigger STK.
// Body: { event_id, phone, items: [{ticket_type_id, qty}], buyer_email?, channel?: "web"|"gate" }
import { corsHeaders, json } from "../_shared/cors.ts";
import { initiateStk } from "../_shared/daraja.ts";
import { normalizePhone, serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { event_id, phone, items, buyer_email, channel = "web" } = await req.json();
    const buyerPhone = normalizePhone(phone ?? "");
    if (!buyerPhone) return json({ error: "invalid_phone" }, 400);
    if (!Array.isArray(items) || items.length === 0) return json({ error: "no_items" }, 400);
    if (channel !== "web" && channel !== "gate") return json({ error: "bad_channel" }, 400);

    const db = serviceClient();

    const { data: event, error: evErr } = await db
      .from("events").select("id,name,status").eq("id", event_id).single();
    if (evErr || !event || event.status !== "live")
      return json({ error: "event_not_live" }, 400);

    // Resolve prices server-side — never trust client amounts (FR-P2)
    const ids = items.map((i: any) => i.ticket_type_id);
    const { data: types, error: tErr } = await db
      .from("ticket_types").select("*").in("id", ids).eq("event_id", event_id).eq("is_active", true);
    if (tErr || !types || types.length !== ids.length) return json({ error: "bad_items" }, 400);

    let amount = 0;
    const lineItems = items.map((i: any) => {
      const t = types.find((x: any) => x.id === i.ticket_type_id)!;
      const qty = Math.max(1, Math.min(20, parseInt(i.qty) || 1));
      amount += Number(t.price_kes) * qty;
      return { ticket_type_id: t.id, qty, unit_price_kes: t.price_kes };
    });

    const { data: order, error: oErr } = await db.from("orders").insert({
      event_id, buyer_phone: buyerPhone, buyer_email: buyer_email || null,
      channel, amount_kes: amount, status: "pending",
    }).select().single();
    if (oErr || !order) return json({ error: "order_create_failed" }, 500);

    const { error: iErr } = await db.from("order_items").insert(
      lineItems.map((li: any) => ({ ...li, order_id: order.id }))
    );
    if (iErr) return json({ error: "items_create_failed" }, 500);

    try {
      const stk = await initiateStk({
        phone: buyerPhone,
        amount,
        accountRef: order.id.slice(0, 12).toUpperCase(),
        description: `${event.name} ticket`.replace(/[^a-zA-Z0-9 ]/g, ""),
      });
      await db.from("orders")
        .update({ mpesa_checkout_request_id: stk.checkoutRequestId })
        .eq("id", order.id);
      return json({ checkoutRequestId: stk.checkoutRequestId });
    } catch (e) {
      await db.from("orders").update({ status: "failed" }).eq("id", order.id);
      return json({ error: "stk_failed", detail: String(e) }, 502);
    }
  } catch (e) {
    return json({ error: "bad_request", detail: String(e) }, 400);
  }
});
