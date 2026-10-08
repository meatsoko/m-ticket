// FR-P1/P2/P6, FR-G1: create (or reuse) a pending order and trigger STK.
// Body: { event_id, phone, items: [{ticket_type_id, qty}], buyer_email?,
//         channel?: "web"|"gate", order_id? }
//
// Every response carries a `stage` so a failure can be pinned to a checkpoint without
// reading dashboard logs. Nothing secret is ever logged: no consumer key/secret, no
// passkey, no access token, no Authorization header. Phone numbers are masked.
import { json, preflight } from "../_shared/cors.ts";
import { mpesaReady, startOrderStk } from "../_shared/mpesa-order.ts";
import { clientIp, normalizePhone, rateLimit, serviceClient } from "../_shared/supabase.ts";
import { returnBase } from "../_shared/return-url.ts";
import { paystackPaused } from "../_shared/paystack-switch.ts";

// NFR-5. Generous enough for a real buyer retrying a failed PIN, tight enough that the
// endpoint can't be used to spray PIN prompts at arbitrary numbers with our shortcode.
const PER_PHONE = { limit: 5, windowSeconds: 600 };
const PER_IP = { limit: 20, windowSeconds: 600 };

type Stage =
  | "boot" | "parse" | "validate" | "throttle" | "event" | "ticket_types"
  | "price" | "availability" | "order" | "order_items"
  | "daraja_config" | "daraja_stk" | "correlate" | "paystack_init" | "done";

/** Last 3 digits only — enough to match a support call, not enough to be a phone list. */
const maskPhone = (p: string) => (p.length > 3 ? `***${p.slice(-3)}` : "***");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ error: "method_not_allowed", stage: "boot" }, 405);

  // Correlates the log lines of one request with the response the caller got.
  const rid = crypto.randomUUID().slice(0, 8);
  const t0 = Date.now();
  let stage: Stage = "boot";
  const log = (msg: string, extra: Record<string, unknown> = {}) =>
    console.log(JSON.stringify({ rid, stage, ms: Date.now() - t0, msg, ...extra }));
  const fail = (error: string, status: number, extra: Record<string, unknown> = {}) => {
    console.error(JSON.stringify({ rid, stage, ms: Date.now() - t0, error, ...extra }));
    return json({ error, stage, request_id: rid, ...extra }, status);
  };

  try {
    log("request received", { method: req.method });

    // ---- parse ----
    stage = "parse";
    let body: any;
    try {
      body = await req.json();
    } catch (e) {
      return fail("bad_json", 400, { detail: safe(e) });
    }
    log("body parsed", { keys: Object.keys(body ?? {}) });

    // ---- validate ----
    stage = "validate";
    const { event_id, phone, items, channel = "web", order_id, provider = "mpesa" } = body ?? {};
    // Accept both spellings — the checkout form posts `email`.
    const buyerEmail = body?.buyer_email ?? body?.email ?? null;

    const buyerPhone = normalizePhone(String(phone ?? ""));
    if (!buyerPhone) {
      return fail("invalid_phone", 400, { hint: "expected 07XXXXXXXX or 2547XXXXXXXX" });
    }
    if (!event_id || typeof event_id !== "string") return fail("missing_event_id", 400);
    if (!Array.isArray(items) || items.length === 0) return fail("no_items", 400);
    // Web buyers must give an email: the ticket QR is delivered there.
    if (channel === "web" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(buyerEmail ?? "").trim())) {
      return fail("email_required", 400);
    }
    if (channel !== "web" && channel !== "gate") return fail("bad_channel", 400);
    if (provider !== "mpesa" && provider !== "paystack") return fail("bad_provider", 400);
    if (provider === "paystack" && channel !== "web") return fail("bad_provider", 400);
    // Before any order is created, so a paused payment leaves nothing pending.
    if (provider === "paystack" && paystackPaused()) return fail("payments_paused", 503);
    if (provider === "mpesa") {
      const ready = mpesaReady();
      if (!ready.ok) return fail(ready.error, 503, ready.missing ? { missing: ready.missing } : {});
    }
    log("validated", { phone: maskPhone(buyerPhone), channel, item_count: items.length });

    const db = serviceClient();

    // ---- throttle (NFR-5) ----
    stage = "throttle";
    // Gate sales are made by authenticated staff standing at the gate; throttling them
    // would punish a busy queue. Public web checkout is the abuse surface.
    const phoneBucket = `stk:phone:${buyerPhone}`;
    const ipBucket = `stk:ip:${clientIp(req)}`;
    const throttled = channel === "web";
    if (throttled) {
      // Peek only. The counter is committed after Daraja accepts, so a mistyped event or
      // a sold-out type does not burn a real buyer's allowance.
      const byPhone = await rateLimit(db, phoneBucket, PER_PHONE.limit, PER_PHONE.windowSeconds, { increment: false });
      if (!byPhone.allowed) {
        return fail("rate_limited", 429, { scope: "phone", retry_after: byPhone.retryAfter });
      }
      const byIp = await rateLimit(db, ipBucket, PER_IP.limit, PER_IP.windowSeconds, { increment: false });
      if (!byIp.allowed) {
        return fail("rate_limited", 429, { scope: "ip", retry_after: byIp.retryAfter });
      }
      log("throttle ok");
    } else {
      log("throttle skipped (gate channel)");
    }

    // ---- event ----
    stage = "event";
    const { data: event, error: evErr } = await db
      .from("events").select("id,name,status,payments_enabled").eq("id", event_id).single();
    if (evErr || !event) return fail("event_not_found", 400, { detail: evErr?.message });
    if (event.status !== "live") return fail("event_not_live", 400, { status: event.status });
    // Kill switch while M-Pesa provisioning is pending. Refuse before creating
    // an order, so nothing is left pending that can never be paid.
    if (event.payments_enabled === false) return fail("payments_unavailable", 409);
    log("event ok", { event: event.name });

    // ---- ticket types: resolve prices server-side, never trust client amounts ----
    stage = "ticket_types";
    const ids = [...new Set(items.map((i: any) => i.ticket_type_id))];
    const { data: types, error: tErr } = await db
      .from("ticket_types").select("*").in("id", ids).eq("event_id", event_id).eq("is_active", true);
    if (tErr) return fail("ticket_types_query_failed", 500, { detail: tErr.message });
    if (!types || types.length !== ids.length) {
      return fail("bad_items", 400, { requested: ids.length, matched: types?.length ?? 0 });
    }
    log("ticket types ok", { count: types.length });

    // ---- price ----
    stage = "price";
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
    if (amount < 1) return fail("zero_amount", 400);
    log("priced", { amount_kes: amount });

    // ---- availability (R3) ----
    stage = "availability";
    // Refuse before taking money rather than flagging the order afterwards. Counts
    // in-flight orders too, so concurrent buyers can't all pass the check and all pay.
    const { data: avail, error: aErr } = await db.rpc("availability", { p_event_id: event_id });
    if (aErr) return fail("availability_check_failed", 500, { detail: aErr.message });
    for (const li of lineItems) {
      const a = (avail ?? []).find((x: any) => x.ticket_type_id === li.ticket_type_id);
      if (!a || a.remaining === null) continue; // uncapped
      const t = types.find((x: any) => x.id === li.ticket_type_id);
      const wanted = li.qty * (t?.bundle_qty ?? 1);
      if (wanted > a.remaining) {
        return fail("sold_out", 409, { ticket_type: t?.name ?? "ticket", remaining: a.remaining });
      }
    }
    log("availability ok");

    // ---- order (FR-P6: a retry reuses the same row with a new checkout id) ----
    stage = "order";
    let order: any = null;
    if (order_id) {
      const { data: existing } = await db.from("orders")
        .select("*").eq("id", order_id).eq("buyer_phone", buyerPhone).maybeSingle();
      if (existing && (existing.status === "failed" || existing.status === "pending")) {
        const { data: reset } = await db.from("orders").update({
          status: "pending", amount_kes: amount,
          buyer_email: buyerEmail || existing.buyer_email,
          mpesa_checkout_request_id: null,
          paystack_reference: null, payment_provider: provider,
        }).eq("id", existing.id).select().single();
        order = reset;
        if (order) {
          await db.from("order_items").delete().eq("order_id", order.id);
          await db.from("order_items").insert(lineItems.map((li: any) => ({ ...li, order_id: order.id })));
          log("reusing order", { order_id: order.id });
        }
      }
    }

    if (!order) {
      const { data: created, error: oErr } = await db.from("orders").insert({
        event_id, buyer_phone: buyerPhone, buyer_email: buyerEmail || null,
        channel, amount_kes: amount, status: "pending",
        payment_provider: provider,
      }).select().single();
      if (oErr || !created) return fail("order_create_failed", 500, { detail: oErr?.message });
      order = created;
      log("order created", { order_id: order.id });

      stage = "order_items";
      const { error: iErr } = await db.from("order_items").insert(
        lineItems.map((li: any) => ({ ...li, order_id: order.id }))
      );
      if (iErr) return fail("items_create_failed", 500, { detail: iErr.message, order_id: order.id });
      log("order items created");
    }

    // Paystack hosted checkout. Amount and order contents are computed above on the
    // server. Its secret key never reaches the browser; only its checkout URL does.
    if (provider === "paystack") {
      stage = "paystack_init";
      const secret = Deno.env.get("PAYSTACK_SECRET_KEY")?.trim();
      const appUrl = Deno.env.get("APP_URL")?.trim()?.replace(/\/$/, "");
      if (!secret || !appUrl) {
        await db.from("orders").update({ status: "failed" }).eq("id", order.id);
        return fail("paystack_misconfigured", 500, { missing: [!secret && "PAYSTACK_SECRET_KEY", !appUrl && "APP_URL"].filter(Boolean) });
      }
      const reference = `MT${crypto.randomUUID().replaceAll("-", "")}`;
      const { data: evForReturn } = await db.from("events").select("slug").eq("id", event_id).single();
      const { error: refErr } = await db.from("orders").update({ paystack_reference: reference }).eq("id", order.id);
      if (refErr) return fail("order_correlation_failed", 500, { detail: refErr.message, order_id: order.id });
      let response: any;
      try {
        const init = await fetch("https://api.paystack.co/transaction/initialize", {
          method: "POST",
          headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            email: String(buyerEmail).trim(), amount: Math.round(amount * 100), currency: "KES",
            // No `channels` list: Paystack offers every method enabled on the account (card, M-Pesa and the rest).
            reference, callback_url: `${returnBase(req, appUrl)}/e/${encodeURIComponent(evForReturn?.slug ?? "")}?payment=paystack`,
            metadata: { order_id: order.id, event_id },
          }),
        });
        response = await init.json();
        if (!init.ok || response?.status !== true || !response?.data?.authorization_url || response?.data?.reference !== reference) {
          throw new Error(response?.message ?? `Paystack returned HTTP ${init.status}`);
        }
      } catch (e) {
        await db.from("orders").update({ status: "failed" }).eq("id", order.id);
        return fail("paystack_init_failed", 502, { detail: safe(e), order_id: order.id });
      }
      if (throttled) {
        await rateLimit(db, phoneBucket, PER_PHONE.limit, PER_PHONE.windowSeconds);
        await rateLimit(db, ipBucket, PER_IP.limit, PER_IP.windowSeconds);
      }
      // accessCode lets the page open Paystack as a popup; authorizationUrl is the redirect fallback.
      return json({ authorizationUrl: response.data.authorization_url, accessCode: response.data.access_code, reference, orderId: order.id, stage: "done", request_id: rid });
    }

    // ---- STK: Daraja M-Pesa Express to the till (migration 20261008140000) ----
    // The ledger row, the prompt and the checkout id on the order all come from
    // startOrderStk; only verifyMpesa (STK Push Query) can mark the order paid.
    stage = "daraja_stk";
    const stk = await startOrderStk(db, {
      orderId: order.id, amountKes: amount, phone: buyerPhone,
      accountRef: order.id.slice(0, 12), description: "Event ticket",
    });
    if (!stk.ok) return fail(stk.error, stk.error === "stk_failed" ? 502 : 500, { detail: stk.detail, order_id: order.id });
    log("stk accepted", { checkout_request_id: stk.checkoutRequestId, ref: stk.reference.slice(0, 10) });
    // A PIN prompt was actually delivered — that is the thing worth rate limiting.
    if (throttled) {
      await rateLimit(db, phoneBucket, PER_PHONE.limit, PER_PHONE.windowSeconds);
      await rateLimit(db, ipBucket, PER_IP.limit, PER_IP.windowSeconds);
    }

    stage = "done";
    log("success", { order_id: order.id });
    return json({ checkoutRequestId: stk.checkoutRequestId, reference: stk.reference, orderId: order.id, stage, request_id: rid });
  } catch (e) {
    // Anything unanticipated still returns a structured, non-sensitive response instead
    // of letting the isolate die with the caller seeing only a network error.
    console.error(JSON.stringify({
      rid, stage, ms: Date.now() - t0, error: "unhandled",
      detail: safe(e), stack: e instanceof Error ? (e.stack ?? "").slice(0, 900) : undefined,
    }));
    return json({ error: "server_error", stage, request_id: rid, detail: safe(e) }, 500);
  }
});

/**
 * Error text with anything credential-shaped stripped. initiateStk embeds Daraja's JSON
 * reply in its message, which is exactly what we want to surface — but the message could
 * also be built from a URL or header elsewhere, so redact defensively.
 */
function safe(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw
    .replace(/(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .replace(/("?(?:Password|Passkey|ConsumerSecret|access_token)"?\s*[:=]\s*)"?[^",}\s]+/gi, '$1"[redacted]"')
    .slice(0, 400);
}
