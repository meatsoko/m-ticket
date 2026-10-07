// Safaricom's M-Pesa Express result for an STK push started by payhero-pay with
// MPESA_PROVIDER=daraja (migration 20261008120000). Named without "mpesa":
// Safaricom refuses callback URLs containing it.
//
// The callback is NOT signed, so it decides nothing: it only tells us which
// payment to look at. verifyMpesa() then asks Safaricom's STK Push Query, and
// only a success from there confirms. The receipt number (which the query
// doesn't return) is taken from the callback as a label for staff.
//
// Always answers ResultCode 0 so Safaricom doesn't retry; payhero-reconcile
// catches anything missed.
import { rateLimit, serviceClient } from "../_shared/supabase.ts";
import { verifyMpesa } from "../_shared/payhero.ts";

const RECEIPT = /^[A-Z0-9]{8,12}$/;

Deno.serve(async (req) => {
  const body: any = await req.json().catch(() => null);
  const cb = body?.Body?.stkCallback;
  const checkoutId = String(cb?.CheckoutRequestID ?? "");
  if (!checkoutId || checkoutId.length > 80) return accept();

  const db = serviceClient();
  const gate = await rateLimit(db, "stk-result:global", 300, 60);
  if (!gate.allowed) return accept();

  const { data: row } = await db.from("payhero_payments").select("reference,status,mpesa_receipt,order_id")
    .eq("checkout_request_id", checkoutId).eq("provider", "daraja").maybeSingle();
  if (!row) { console.log(JSON.stringify({ msg: "stk-result for an unknown checkout", id: checkoutId.slice(0, 18) })); return accept(); }

  const items: any[] = cb?.CallbackMetadata?.Item ?? [];
  const receipt = String(items.find((i) => i?.Name === "MpesaReceiptNumber")?.Value ?? "");
  const label = Number(cb?.ResultCode) === 0 && RECEIPT.test(receipt) ? receipt : null;

  try {
    const out = await verifyMpesa(db, row.reference);
    // Only once Safaricom itself says paid is the callback's receipt recorded
    // (a forged callback can't label a payment), and never over an existing one.
    if (label && out.status === "success") {
      await db.from("payhero_payments").update({ mpesa_receipt: label }).eq("reference", row.reference).is("mpesa_receipt", null);
      if (row.order_id) await db.from("orders").update({ mpesa_receipt: label }).eq("id", row.order_id).is("mpesa_receipt", null);
    }
    console.log(JSON.stringify({ msg: "stk-result", ref: row.reference.slice(0, 10), status: out.status, result: out.result ?? null }));
  } catch (e) {
    console.error(JSON.stringify({ msg: "stk-result check failed", ref: row.reference.slice(0, 10), detail: String((e as Error)?.message ?? e).slice(0, 160) }));
  }
  return accept();
});

const accept = () => new Response(JSON.stringify({ ResultCode: 0, ResultDesc: "Accepted" }), { headers: { "Content-Type": "application/json" } });
