// Daraja asynchronous result callback. Must be publicly reachable HTTPS (SRS A2).
// Idempotency lives in confirm_payment() (unique checkout_request_id + state check).
import { serviceClient } from "../_shared/supabase.ts";
import { sendTicketEmail } from "../_shared/email.ts";

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

  if (resultCode === 0) {
    const items: any[] = cb.CallbackMetadata?.Item ?? [];
    const get = (n: string) => items.find((i) => i.Name === n)?.Value;
    const amount = Number(get("Amount"));
    const receipt = String(get("MpesaReceiptNumber") ?? "");

    for (let attempt = 0; attempt < LOOKUP_RETRIES; attempt++) {
      const { data, error } = await db.rpc("confirm_payment", {
        p_checkout_request_id: checkoutId,
        p_receipt: receipt,
        p_amount: amount,
      });
      if (error) { console.error("confirm_payment error", checkoutId, error); break; }
      console.log("confirm_payment:", checkoutId, JSON.stringify(data));

      const result = (data as any)?.result;
      if (result === "confirmed") {
        // FR-T2(b). Only on the first confirmation, so duplicate callbacks don't
        // re-send. Never let a mail failure affect the payment result.
        await deliverEmail(db, (data as any).order_id).catch((e) =>
          console.error("ticket email failed", checkoutId, e));
        return accept();
      }
      if (result !== "unknown") return accept();
      if (attempt < LOOKUP_RETRIES - 1) await sleep(LOOKUP_BACKOFF_MS);
    }
    // Paid money we cannot attach to an order — must be loud, not silent (SRS §5.4).
    console.error("UNRECONCILED PAYMENT", JSON.stringify({ checkoutId, receipt, amount }));
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
