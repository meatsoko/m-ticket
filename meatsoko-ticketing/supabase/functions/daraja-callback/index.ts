// Daraja asynchronous result callback. Must be publicly reachable HTTPS (SRS A2).
// Idempotency lives in confirm_payment() (unique checkout_request_id + state check).
import { serviceClient } from "../_shared/supabase.ts";

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
      if ((data as any)?.result !== "unknown") return accept();
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function accept() {
  return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: "Accepted" }), {
    headers: { "Content-Type": "application/json" },
  });
}
