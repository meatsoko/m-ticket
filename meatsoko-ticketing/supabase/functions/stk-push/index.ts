// FR-P1/P2/P6, FR-G1: create (or reuse) a pending order and trigger STK.
// Body: { event_id, phone, items: [{ticket_type_id, qty}], buyer_email?,
//         channel?: "web"|"gate", order_id? }
import { corsHeaders, json } from "../_shared/cors.ts";
import { initiateStk } from "../_shared/daraja.ts";
import { clientIp, normalizePhone, rateLimit, serviceClient } from "../_shared/supabase.ts";

// NFR-5. Generous enough for a real buyer retrying a failed PIN, tight enough that the
// endpoint can't be used to spray PIN prompts at arbitrary numbers with our shortcode.
const PER_PHONE = { limit: 4, windowSeconds: 600 };
const PER_IP = { limit: 20, windowSeconds: 600 };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json();
    const { event_id, phone, items, channel = "web", order_id } = body;
    // Accept both spellings — the checkout form posts `email`.
    const buyerEmail = body.buyer_email ?? body.email ?? null;
    const buyerPhone = normalizePhone(phone ?? "");
    if (!buyerPhone) return json({ error: "invalid_phone" }, 400);
    if (!Array.isArray(items) || items.length === 0) return json({ error: "no_items" }, 400);
    if (channel !== "web" && channel !== "gate") return json({ error: "bad_channel" }, 400);

    const db = serviceClient();

    // Gate sales are made by authenticated staff standing at the gate; throttling them
    // would punish a busy queue. Public web checkout is the abuse surface.
    if (channel === "web") {
      const byPhone = await rateLimit(db, `stk:phone:${buyerPhone}`, PER_PHONE.limit, PER_PHONE.windowSeconds);
      if (!byPhone.allowed) return json({ error: "rate_limited", retry_after: byPhone.retryAfter }, 429);
      const byIp = await rateLimit(db, `stk:ip:${clientIp(req)}`, PER_IP.limit, PER_IP.windowSeconds);
      if (!byIp.allowed) return json({ error: "rate_limited", retry_after: byIp.retryAfter }, 429);
    }

    const { data: event, error: evErr } = await db
      .from("events").select("id,name,status").eq("id", event_id).single();
    if (evErr || !event || event.status !== "live")
      return json({ error: "event_not_live" }, 400);

    // Resolve prices server-side — never trust client amounts (FR-P2)
    const ids = [...new Set(items.map((i: any) => i.ticket_type_id))];
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
    // Daraja only accepts whole shillings >= 1; confirm_payment compares the callback
    // amount against orders.amount_kes, so both must be the rounded figure.
    amount = Math.round(amount);
    if (amount < 1) return json({ error: "zero_amount" }, 400);

    // R3: refuse before taking money rather than flagging the order afterwards. Counts
    // in-flight orders too, so concurrent buyers can't all pass the check and all pay.
    const { data: avail } = await db.rpc("availability", { p_event_id: event_id });
    for (const li of lineItems) {
      const a = (avail ?? []).find((x: any) => x.ticket_type_id === li.ticket_type_id);
      if (!a || a.remaining === null) continue; // uncapped
      const wanted = li.qty * (types.find((t: any) => t.id === li.ticket_type_id)?.bundle_qty ?? 1);
      if (wanted > a.remaining) {
        const name = types.find((t: any) => t.id === li.ticket_type_id)?.name ?? "ticket";
        return json({ error: "sold_out", ticket_type: name, remaining: a.remaining }, 409);
      }
    }

    // FR-P6: a retry reuses the same order row with a new checkout id rather than
    // littering the dashboard with a fresh failed order per attempt.
    let order: any = null;
    if (order_id) {
      const { data: existing } = await db.from("orders")
        .select("*").eq("id", order_id).eq("buyer_phone", buyerPhone).maybeSingle();
      if (existing && (existing.status === "failed" || existing.status === "pending")) {
        const { data: reset } = await db.from("orders").update({
          status: "pending", amount_kes: amount,
          buyer_email: buyerEmail || existing.buyer_email,
          mpesa_checkout_request_id: null,
        }).eq("id", existing.id).select().single();
        order = reset;
        if (order) {
          await db.from("order_items").delete().eq("order_id", order.id);
          await db.from("order_items").insert(lineItems.map((li: any) => ({ ...li, order_id: order.id })));
        }
      }
    }

    if (!order) {
      const { data: created, error: oErr } = await db.from("orders").insert({
        event_id, buyer_phone: buyerPhone, buyer_email: buyerEmail || null,
        channel, amount_kes: amount, status: "pending",
      }).select().single();
      if (oErr || !created) return json({ error: "order_create_failed" }, 500);
      order = created;

      const { error: iErr } = await db.from("order_items").insert(
        lineItems.map((li: any) => ({ ...li, order_id: order.id }))
      );
      if (iErr) return json({ error: "items_create_failed" }, 500);
    }

    try {
      const stk = await initiateStk({
        phone: buyerPhone,
        amount,
        accountRef: order.id.slice(0, 12).toUpperCase(),
        description: `${event.name} ticket`.replace(/[^a-zA-Z0-9 ]/g, ""),
      });
      // The callback is correlated solely by checkout id, so an order that never gets one
      // is unreconcilable money. Flag it rather than leaving it silently pending.
      const { error: uErr } = await db.from("orders")
        .update({ mpesa_checkout_request_id: stk.checkoutRequestId })
        .eq("id", order.id);
      if (uErr) {
        console.error("checkout id not persisted", order.id, uErr);
        await db.from("orders").update({ status: "flagged" }).eq("id", order.id);
        return json({ error: "order_correlation_failed" }, 500);
      }
      return json({ checkoutRequestId: stk.checkoutRequestId, orderId: order.id });
    } catch (e) {
      console.error("stk initiation failed", order.id, e);
      await db.from("orders").update({ status: "failed" }).eq("id", order.id);
      return json({ error: "stk_failed", detail: String(e), orderId: order.id }, 502);
    }
  } catch (e) {
    return json({ error: "bad_request", detail: String(e) }, 400);
  }
});
