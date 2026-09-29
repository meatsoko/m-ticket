// Merchandise payment helpers, shared by merch-order (buyer returning from Paystack)
// and paystack-webhook (Paystack calling us). Whichever arrives first confirms the
// order; merch_confirm_payment() is idempotent, so the second is a no-op.
//
// Merchandise references are "MS" + 32 hex. Ticket/reservation references are "MT"
// + 32 hex and never reach this file — paystack-webhook routes on the prefix.
import { serviceClient } from "./supabase.ts";
import { escapeHtml as esc, sendEmail } from "./resend.ts";

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
    const [buyer, organiser] = await Promise.all([
      sendMerchOrderEmail(db, result.order_id).catch((e) => ({ sent: false, reason: String(e) })),
      notifyMerchOrder(db, result.order_id).catch((e) => ({ sent: false, reason: String(e) })),
    ]);
    console.log(JSON.stringify({ msg: "merch order emails", order: result.order_number, buyer, organiser }));
  }
  return result;
}

const kes = (n: number) => `KSh ${Math.round(Number(n)).toLocaleString("en-KE")}`;
const usd = (n: number) => `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

type OrderForMail = {
  order_number: string; access_token: string; first_name: string; last_name: string; email: string; phone: string;
  total_kes: number; total_usd: number; subtotal_usd: number; delivery_fee_usd: number;
  delivery_code: string; delivery_address: string | null; delivery_town: string | null; delivery_sacco: string | null; notes: string | null;
  merch_delivery_options: { label: string; blurb: string | null } | null;
  merch_zone: { name: string } | null;
  merch_order_items: { product_name: string; color: string; size: string; qty: number; unit_price_usd: number }[];
};

async function loadOrder(db: Db, orderId: string): Promise<OrderForMail | null> {
  const { data } = await db.from("merch_orders")
    .select("order_number,access_token,first_name,last_name,email,phone,total_kes,total_usd,subtotal_usd,delivery_fee_usd,delivery_code,delivery_address,delivery_town,delivery_sacco,notes,merch_delivery_options(label,blurb),merch_zone:merch_delivery_zones(name),merch_order_items(product_name,color,size,qty,unit_price_usd)")
    .eq("id", orderId).maybeSingle();
  return (data as any) ?? null;
}

/**
 * Buyer's confirmation, in the same shape as the reservation pass email (card,
 * reference block, one button) so every MeatSoko email reads as one family.
 * Prices in USD; one line gives the KES Paystack charged, which is what appears
 * on the buyer's M-Pesa or card statement.
 */
export async function sendMerchOrderEmail(db: Db, orderId: string): Promise<{ sent: boolean; reason?: string }> {
  const appUrl = (Deno.env.get("APP_URL") ?? "").trim().replace(/\/+$/, "");
  if (!appUrl) return { sent: false, reason: "no_app_url" };
  const o = await loadOrder(db, orderId);
  if (!o) return { sent: false, reason: "order_not_found" };

  const url = `${appUrl}/order/${o.access_token}`;
  const delivery = o.merch_delivery_options?.label ?? o.delivery_code;
  const deliveryFee = Number(o.delivery_fee_usd) ? usd(o.delivery_fee_usd) : "Free";
  const rows = o.merch_order_items.map((i) => `<tr>
      <td style="padding:6px 0">${i.qty} × ${esc(i.product_name)}<br><span style="color:#77736e;font-size:12px">${esc(i.color)} · ${esc(i.size)}</span></td>
      <td style="padding:6px 0;text-align:right;vertical-align:top">${usd(i.unit_price_usd * i.qty)}</td></tr>`).join("");

  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;color:#171717">
  <h2 style="margin:0 0 2px">MeatSoko merchandise</h2>
  <p style="margin:0 0 18px;color:#77736e">Order confirmation</p>

  <p>Hi ${esc(o.first_name)}, thank you — your order is confirmed.</p>

  <div style="border:1px solid #dedbd4;border-radius:12px;padding:18px;text-align:center;margin:18px 0">
    <div style="font-size:26px;font-weight:800;letter-spacing:.06em">${esc(o.order_number)}</div>
    <div style="color:#77736e;font-size:14px;margin-top:4px">${esc(delivery)}${o.delivery_town ? ` &middot; ${esc(o.delivery_town)}` : ""}</div>
  </div>

  <div style="border:1px solid #dedbd4;border-radius:12px;padding:14px 18px;margin:18px 0">
    <div style="font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#77736e">Your order</div>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:6px">${rows}
      <tr><td style="padding:6px 0">${esc(delivery)}</td><td style="padding:6px 0;text-align:right">${deliveryFee}</td></tr>
      <tr><td style="padding-top:8px;border-top:1px solid #dedbd4"><strong>Total</strong></td>
      <td style="padding-top:8px;border-top:1px solid #dedbd4;text-align:right"><strong>${usd(o.total_usd)}</strong></td></tr>
    </table>
    <p style="font-size:12px;color:#77736e;margin:8px 0 0">Charged by Paystack as ${kes(o.total_kes)}.</p>
  </div>

  ${o.merch_delivery_options?.blurb ? `<p style="font-size:14px;color:#4f4b46">${esc(o.merch_delivery_options.blurb)}</p>` : ""}

  <p style="text-align:center;margin:18px 0">
    <a href="${esc(url)}" style="background:#d32f3b;color:#fff;text-decoration:none;
       padding:12px 22px;border-radius:999px;font-weight:700;display:inline-block">Track my order</a>
  </p>
  <p style="font-size:13px;color:#77736e">Keep your order number — you may be asked for it at pickup.<br>
    <a href="${esc(url)}" style="color:#d32f3b">${esc(url)}</a></p>
</div>`;

  const text = [
    "MeatSoko merchandise — order confirmation", "",
    `Hi ${o.first_name}, thank you — your order ${o.order_number} is confirmed.`, "",
    ...o.merch_order_items.map((i) => `  ${i.qty} x ${i.product_name} (${i.color}, ${i.size}): ${usd(i.unit_price_usd * i.qty)}`),
    `  ${delivery}: ${deliveryFee}`,
    `  Total: ${usd(o.total_usd)} (charged by Paystack as ${kes(o.total_kes)})`, "",
    `Track your order: ${url}`,
  ].join("\n");

  return sendEmail({ to: o.email, subject: `Your MeatSoko order ${o.order_number}`, html, text });
}

/**
 * Tells the organiser a paid merchandise order needs packing — the merch
 * counterpart of notifyOrganizer() for reservations. Merchandise has no event to
 * hold a notify address, so the destination is the MERCH_NOTIFY_EMAIL secret
 * (comma-separated for several). Unset = no-op; orders still show in the database.
 */
export async function notifyMerchOrder(db: Db, orderId: string): Promise<{ sent: boolean; reason?: string }> {
  const to = (Deno.env.get("MERCH_NOTIFY_EMAIL") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!to.length) return { sent: false, reason: "no_notify_address" };
  const o = await loadOrder(db, orderId);
  if (!o) return { sent: false, reason: "order_not_found" };

  const body = [
    `New paid merchandise order ${o.order_number}`, "",
    `Customer:  ${o.first_name} ${o.last_name}`,
    `Phone:     ${o.phone}`,
    `Email:     ${o.email}`, "",
    ...o.merch_order_items.map((i) => `  ${i.qty} x ${i.product_name} — ${i.color}, size ${i.size}`), "",
    `Delivery:  ${o.merch_delivery_options?.label ?? o.delivery_code}`,
    ...(o.merch_zone?.name ? [`Area:      ${o.merch_zone.name}`] : []),
    ...(o.delivery_address ? [`Address:   ${o.delivery_address}`] : []),
    ...(o.delivery_town ? [`Town:      ${o.delivery_town}`] : []),
    ...(o.delivery_sacco ? [`Sacco:     ${o.delivery_sacco}`] : []),
    ...(o.notes ? ["", `Notes:     ${o.notes}`] : []), "",
    `Total:     ${usd(o.total_usd)} (paid ${kes(o.total_kes)} via Paystack)`,
  ];
  return sendEmail({
    to,
    subject: `Merch order ${o.order_number} — ${o.merch_order_items.reduce((n, i) => n + i.qty, 0)} item(s), ${o.merch_delivery_options?.label ?? o.delivery_code}`,
    text: body.join("\n"),
    html: `<pre style="font-family:ui-monospace,monospace;font-size:14px">${body.map((l) => esc(l)).join("\n")}</pre>`,
  });
}
