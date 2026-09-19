// Daraja asynchronous result callback. Must be publicly reachable HTTPS (SRS A2).
// Idempotency lives in confirm_payment() (unique checkout_request_id + state check).
import { serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  let body: any;
  try { body = await req.json(); } catch { return accept(); }

  const cb = body?.Body?.stkCallback;
  if (!cb) return accept();

  const db = serviceClient();
  const checkoutId: string = cb.CheckoutRequestID;
  const resultCode: number = cb.ResultCode;

  if (resultCode === 0) {
    const items: any[] = cb.CallbackMetadata?.Item ?? [];
    const get = (n: string) => items.find((i) => i.Name === n)?.Value;
    const amount = Number(get("Amount"));
    const receipt = String(get("MpesaReceiptNumber") ?? "");
    const { data } = await db.rpc("confirm_payment", {
      p_checkout_request_id: checkoutId,
      p_receipt: receipt,
      p_amount: amount,
    });
    console.log("confirm_payment:", JSON.stringify(data));
  } else {
    // Cancelled / timeout / insufficient funds (FR-P6)
    const { error } = await db.from("orders")
      .update({ status: "failed" })
      .eq("mpesa_checkout_request_id", checkoutId)
      .eq("status", "pending");
    if (error) console.error("fail-update error", error);
  }
  return accept();
});

function accept() {
  return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: "Accepted" }), {
    headers: { "Content-Type": "application/json" },
  });
}
