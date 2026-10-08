// M-Pesa for an event order that already exists (paid tickets and gate sales from
// stk-push, bookings with a paid pre-order from reserve) — through the same Daraja
// path as every other M-Pesa payment (migration 20261008140000): a "PH…" ledger row
// in payhero_payments, an STK push to the till with darajaStkPush, and confirmation
// only by verifyMpesa (STK Push Query), never by a callback.
//
// The order also gets Daraja's CheckoutRequestID in mpesa_checkout_request_id, so
// the pages that poll order-status by checkout id keep working unchanged.
import { darajaConfigured, darajaOpen, darajaStkPush } from "./daraja-express.ts";
import { newPayheroReference, verifyMpesa } from "./payhero.ts";

type Db = any;

/** Open and set up, or the reason it isn't (never a secret value). */
export function mpesaReady(): { ok: true } | { ok: false; error: "mpesa_unavailable" | "daraja_misconfigured"; missing?: string[] } {
  if (!darajaOpen()) return { ok: false, error: "mpesa_unavailable" };
  const cfg = darajaConfigured();
  return cfg.ok ? { ok: true } : { ok: false, error: "daraja_misconfigured", missing: cfg.missing };
}

/**
 * Send the prompt for `orderId`. On failure the order is failed (through
 * fail_payhero_payment, which leaves it pending if another prompt is still open).
 */
export async function startOrderStk(db: Db, o: {
  orderId: string; amountKes: number; phone: string; accountRef: string; description: string;
}): Promise<{ ok: true; checkoutRequestId: string; reference: string } | { ok: false; error: string; detail?: string }> {
  const reference = newPayheroReference();
  const { error: lErr } = await db.from("payhero_payments").insert({
    reference, kind: "event", provider: "daraja", order_id: o.orderId, phone: o.phone, amount_kes: o.amountKes,
  });
  if (lErr) return { ok: false, error: "ledger_failed", detail: lErr.message };

  const stk = await darajaStkPush({
    amountKes: o.amountKes, phone: o.phone,
    // Daraja: AccountReference ≤ 12, TransactionDesc ≤ 13 characters.
    accountRef: o.accountRef.replace(/[^A-Za-z0-9]/g, "").slice(0, 12).toUpperCase(),
    description: o.description.replace(/[^A-Za-z0-9 ]/g, "").slice(0, 13),
  });
  if (!stk.ok) {
    await db.rpc("fail_payhero_payment", { p_reference: reference, p_reason: `stk_not_sent: ${stk.detail}` });
    return { ok: false, error: "stk_failed", detail: stk.detail };
  }
  const now = new Date().toISOString();
  await db.from("payhero_payments").update({
    checkout_request_id: stk.checkoutRequestId, merchant_request_id: stk.merchantRequestId, updated_at: now,
  }).eq("reference", reference);
  const { error: oErr } = await db.from("orders")
    .update({ mpesa_checkout_request_id: stk.checkoutRequestId, payment_provider: "mpesa" }).eq("id", o.orderId);
  // The ledger row carries the checkout id, so the payment still confirms (callback,
  // reconcile) even if this write failed; only order-status polling would miss it.
  if (oErr) console.error(JSON.stringify({ msg: "order checkout id not stored", ref: reference.slice(0, 10), detail: oErr.message }));
  return { ok: true, checkoutRequestId: stk.checkoutRequestId, reference };
}

/**
 * While a page waits on an order, ask Safaricom about its open prompts instead of
 * waiting for the callback or the 2-minute reconcile. Errors are logged, never thrown:
 * the caller reads the order's status afterwards either way.
 */
export async function nudgeOrder(db: Db, orderId: string): Promise<void> {
  const { data: open } = await db.from("payhero_payments")
    .select("reference").eq("order_id", orderId).eq("status", "queued").order("created_at", { ascending: false }).limit(3);
  for (const p of open ?? []) {
    try { await verifyMpesa(db, p.reference); }
    catch (e) { console.error(JSON.stringify({ msg: "order nudge failed", ref: String(p.reference).slice(0, 10), detail: String(e).slice(0, 160) })); }
  }
}
