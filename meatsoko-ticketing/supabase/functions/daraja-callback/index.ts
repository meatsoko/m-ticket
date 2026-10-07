// Daraja asynchronous result callback for the legacy paid-ticket checkout
// (stk-push). Must be publicly reachable HTTPS (SRS A2).
// Idempotency lives in confirm_payment() (unique checkout_request_id + state check).
//
// The callback is NOT signed, and the buyer's browser is told its
// CheckoutRequestID, so its contents are never believed (2026-10-07): before
// anything changes we ask Safaricom's STK Push Query, and the amount confirmed
// is the order's own, never the callback's.
import { rateLimit, serviceClient } from "../_shared/supabase.ts";
import { queryStk } from "../_shared/daraja-express.ts";
import { sendTicketEmail } from "../_shared/email.ts";
import { buildAndSend } from "../_shared/reservation-email.ts";

// stk-push writes mpesa_checkout_request_id immediately after Daraja responds, but the
// callback is a separate connection and can in principle land first. Retry briefly rather
// than dropping a real payment on the floor.
const LOOKUP_RETRIES = 5;
const LOOKUP_BACKOFF_MS = 1500;

Deno.serve(async (req) => {
  let body: any;
  try { body = await req.json(); } catch { return accept(); }

  const cb = body?.Body?.stkCallback;
  if (!cb) return accept();

  const db = serviceClient();
  const checkoutId: string = cb.CheckoutRequestID;
  const resultCode: number = Number(cb.ResultCode);
  if (!checkoutId) return accept();

  // Each callback costs a Safaricom query: cap how often anyone can trigger one.
  const gate = await rateLimit(db, "daraja-callback:global", 300, 60);
  if (!gate.allowed) return accept();

  // Safaricom's own answer, not the callback's.
  const verified = await queryStk(checkoutId).catch((e) => {
    console.error("stk query failed", checkoutId, String(e).slice(0, 120));
    return null;
  });
  if (!verified || verified.state === "pending") {
    console.log("callback not acted on: Safaricom says", verified?.state ?? "unavailable", checkoutId);
    return accept();
  }
  if (resultCode === 0 && verified.state !== "success") {
    console.error("callback claims success but Safaricom says", verified.state, checkoutId);
    return accept();
  }

  if (verified.state === "success") {
    const items: any[] = cb.CallbackMetadata?.Item ?? [];
    const get = (n: string) => items.find((i) => i.Name === n)?.Value;
    const receipt = String(get("MpesaReceiptNumber") ?? "");

    for (let attempt = 0; attempt < LOOKUP_RETRIES; attempt++) {
      // The order's own amount: we asked Safaricom for exactly this.
      const { data: ord } = await db.from("orders").select("amount_kes").eq("mpesa_checkout_request_id", checkoutId).maybeSingle();
      const amount = ord ? Number(ord.amount_kes) : NaN;
      const { data, error } = await db.rpc("confirm_payment", {
        p_checkout_request_id: checkoutId,
        p_receipt: receipt,
        p_amount: amount,
      });
      if (error) { console.error("confirm_payment error", checkoutId, error); break; }
      console.log("confirm_payment:", checkoutId, JSON.stringify(data));

      const result = (data as any)?.result;
      if (result === "confirmed") {
        // Only on the FIRST confirmation, so duplicate callbacks never re-send.
        // Never let a mail failure affect the payment result.
        if ((data as any).kind === "reservation") {
          const appUrl = (Deno.env.get("APP_URL") ?? "").trim();
          if (appUrl) {
            await buildAndSend(db, (data as any).reservation_id, appUrl)
              .then((out) => console.log("reservation email", checkoutId, JSON.stringify(out)))
              .catch((e) => console.error("reservation email failed", checkoutId, e));
          }
        } else {
          await deliverEmail(db, (data as any).order_id).catch((e) =>
            console.error("ticket email failed", checkoutId, e));
        }
        return accept();
      }
      if (result !== "unknown") return accept();
      if (attempt < LOOKUP_RETRIES - 1) await sleep(LOOKUP_BACKOFF_MS);
    }
    // Paid money we cannot attach to an order — must be loud, not silent (SRS §5.4).
    console.error("UNRECONCILED PAYMENT", JSON.stringify({ checkoutId, receipt }));
  } else {
    // Cancelled / timeout / insufficient funds (FR-P6)
    const { error } = await db.from("orders")
      .update({ status: "failed" })
      .eq("mpesa_checkout_request_id", checkoutId)
      .eq("status", "pending");
    if (error) console.error("fail-update error", checkoutId, error);
  }
  return accept();
});

async function deliverEmail(db: ReturnType<typeof serviceClient>, orderId: string) {
  if (!orderId) return;
  const { data: order } = await db.from("orders")
    .select("buyer_email,channel,events(name,venue,starts_at)")
    .eq("id", orderId).maybeSingle();
  // Gate sales are handed over in person; there is nothing to email.
  if (!order?.buyer_email || order.channel === "gate") return;

  const { data: tickets } = await db.from("tickets")
    .select("qr_token,ticket_types(name,bundle_qty)")
    .eq("order_id", orderId);
  if (!tickets?.length) return;

  const ev: any = (order as any).events;
  const out = await sendTicketEmail({
    to: order.buyer_email,
    eventName: ev?.name ?? "Your event",
    venue: ev?.venue ?? null,
    startsAt: ev?.starts_at ?? null,
    tickets: tickets.map((t: any) => ({
      token: t.qr_token,
      typeName: t.ticket_types?.name ?? "Ticket",
      bundleQty: t.ticket_types?.bundle_qty ?? 1,
    })),
  });
  console.log("ticket email", orderId, JSON.stringify(out));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function accept() {
  return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: "Accepted" }), {
    headers: { "Content-Type": "application/json" },
  });
}
