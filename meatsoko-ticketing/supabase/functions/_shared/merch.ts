// Merchandise payment helpers, shared by merch-order (buyer returning from Paystack)
// and paystack-webhook (Paystack calling us). Whichever arrives first confirms the
// order; merch_confirm_payment() is idempotent, so the second is a no-op.
//
// Merchandise references are "MS" + 32 hex. Ticket/reservation references are "MT"
// + 32 hex and never reach this file — paystack-webhook routes on the prefix.
import { serviceClient } from "./supabase.ts";

export const MERCH_REFERENCE = /^MS[a-f0-9]{32}$/;

type Db = ReturnType<typeof serviceClient>;

/**
 * Ask Paystack whether `reference` was paid, and if so confirm the order.
 * Never trusts the caller: amount, currency and reference all come from Paystack's
 * own verify endpoint and are compared with the order row.
 */
export async function verifyAndConfirmMerch(reference: string, db: Db = serviceClient()) {
  if (!MERCH_REFERENCE.test(reference)) throw new Error("invalid_reference");

  const { data: order, error } = await db.from("merch_orders")
    .select("id,payment_status,total_kes")
    .eq("paystack_reference", reference).maybeSingle();
  if (error || !order) throw new Error("unknown_reference");
  if (order.payment_status === "paid") return { result: "already", order_id: order.id };
  if (order.payment_status !== "pending" && order.payment_status !== "failed") {
    return { result: "ignored", status: order.payment_status };
  }

  const secret = Deno.env.get("PAYSTACK_SECRET_KEY")?.trim();
  if (!secret) throw new Error("paystack_misconfigured");
  const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(15_000),
  });
  const body: any = await res.json().catch(() => null);
  if (!res.ok || body?.status !== true) throw new Error("paystack_verification_unavailable");
  const tx = body.data;

  if (tx?.status !== "success") {
    // Abandoned or failed at Paystack: release the hold now instead of waiting it out.
    if (tx?.status === "failed" || tx?.status === "abandoned") {
      await db.rpc("merch_fail_order", { p_reference: reference });
    }
    return { result: "not_paid", status: tx?.status ?? "unverified" };
  }
  const expectedMinor = Math.round(Number(order.total_kes) * 100);
  if (tx.reference !== reference || tx.currency !== "KES" || Number(tx.amount) !== expectedMinor) {
    // Money moved, but not the money we asked for: never confirm, flag for a human.
    await db.from("merch_orders")
      .update({ payment_status: "flagged", flag_reason: `paystack_mismatch:${tx.currency}:${tx.amount}` })
      .eq("id", order.id).in("payment_status", ["pending", "failed"]);
    return { result: "mismatch" };
  }

  const { data, error: confirmError } = await db.rpc("merch_confirm_payment", {
    p_reference: reference, p_amount_kes: Number(tx.amount) / 100,
  });
  if (confirmError) throw new Error(`confirmation_failed:${confirmError.message}`);
  const result: any = data;
  if (result?.result === "confirmed") {
    await sendMerchOrderEmail(db, result.order_id)
      .then((r) => console.log(JSON.stringify({ msg: "merch order email", order: result.order_number, ...r })))
      .catch((e) => console.error("merch order email failed", result.order_number, e));
  }
  return result;
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

const kes = (n: number) => `KSh ${Number(n).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;
const usd = (n: number) => `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

/** Order confirmation through Resend. Best effort: a mail failure never un-confirms a payment. */
export async function sendMerchOrderEmail(db: Db, orderId: string): Promise<{ sent: boolean; reason?: string }> {
  const apiKey = (Deno.env.get("RESEND_API_KEY") ?? "").trim();
  const from = (Deno.env.get("TICKET_EMAIL_FROM") ?? "").trim();
  const appUrl = (Deno.env.get("APP_URL") ?? "").trim().replace(/\/+$/, "");
  if (!apiKey) return { sent: false, reason: "not_configured" };
  if (!from) return { sent: false, reason: "no_from_address" };
  if (!appUrl) return { sent: false, reason: "no_app_url" };

  const { data: o } = await db.from("merch_orders")
    .select("order_number,access_token,first_name,email,total_kes,total_usd,delivery_fee_usd,delivery_code,merch_delivery_options(label),merch_order_items(product_name,color,size,qty,unit_price_usd)")
    .eq("id", orderId).maybeSingle();
  if (!o) return { sent: false, reason: "order_not_found" };
  const items: any[] = (o as any).merch_order_items ?? [];
  const delivery = (o as any).merch_delivery_options?.label ?? o.delivery_code;
  const url = `${appUrl}/order/${o.access_token}`;

  const rows = items.map((i) => `<tr>
      <td style="padding:8px 0;border-bottom:1px solid #eee">${esc(i.product_name)} — ${esc(i.color)} · ${esc(i.size)} × ${i.qty}</td>
      <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right">${usd(i.unit_price_usd * i.qty)}</td></tr>`).join("");
  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px;color:#171717">
    <h2 style="margin:0 0 6px">Thanks, ${esc(o.first_name)} — your order is confirmed</h2>
    <p style="margin:0 0 18px;color:#77736e">Order ${esc(o.order_number)}</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">${rows}
      <tr><td style="padding:8px 0">${esc(delivery)}</td><td style="padding:8px 0;text-align:right">${Number(o.delivery_fee_usd) ? usd(o.delivery_fee_usd) : "Free"}</td></tr>
      <tr><td style="padding:10px 0;font-weight:700">Total</td><td style="padding:10px 0;text-align:right;font-weight:700">${usd(o.total_usd)}</td></tr>
      <tr><td colspan="2" style="padding:0 0 6px;color:#77736e;font-size:12px">Charged by Paystack as ${kes(o.total_kes)}</td></tr>
    </table>
    <p style="margin-top:18px"><a href="${url}" style="color:#d32f3b;font-weight:700">Track your order</a></p>
    <p style="color:#77736e;font-size:13px">Keep this email — you may be asked for your order number at pickup.</p>
  </div>`;
  const text = [
    `Thanks, ${o.first_name} — your order ${o.order_number} is confirmed.`, "",
    ...items.map((i) => `- ${i.product_name} (${i.color}, ${i.size}) x${i.qty}: ${usd(i.unit_price_usd * i.qty)}`),
    `${delivery}: ${Number(o.delivery_fee_usd) ? usd(o.delivery_fee_usd) : "Free"}`,
    `Total: ${usd(o.total_usd)} (charged by Paystack as ${kes(o.total_kes)})`, "", `Track your order: ${url}`,
  ].join("\n");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ from, to: [o.email], subject: `Your MeatSoko order ${o.order_number}`, html, text }),
  });
  if (!res.ok) return { sent: false, reason: `${res.status} ${(await res.text()).slice(0, 160)}` };
  return { sent: true };
}
