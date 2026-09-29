// Upgrade a General Admission booking to a table (migration 20260929180000).
//
// Body: { access_token, reservation_type_id }
//
// The access_token is the pass itself (the 128-bit token in the QR / pass link
// that was emailed to the guest). It is the ONLY thing that authorises an
// upgrade: a phone number or email never does, so nobody can upgrade — or pay
// against — someone else's booking by knowing their contact details.
//
// This only opens a Paystack payment. The booking is changed by
// confirm_paystack_payment once Paystack says the money arrived (the return
// page, or paystack-reconcile). A cancelled or failed payment leaves the
// booking as General Admission.
import { json, preflight } from "../_shared/cors.ts";
import { clientIp, rateLimit, serviceClient } from "../_shared/supabase.ts";
import { returnBase } from "../_shared/return-url.ts";

const PER_PASS = { limit: 6, windowSeconds: 600 };
const PER_IP = { limit: 30, windowSeconds: 600 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Business refusals the page can explain. Anything else is a 400.
const CONFLICTS = new Set([
  "already_upgraded", "not_general_admission", "not_upgradable", "full", "preorder_sold_out",
  "closed", "event_not_live", "payments_unavailable",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const body = await req.json().catch(() => null);
  const token = String(body?.access_token ?? "");
  const typeId = String(body?.reservation_type_id ?? "");
  // Same answer for a malformed and an unknown token: no oracle.
  if (!/^[a-f0-9]{32}$/.test(token)) return json({ error: "not_found" }, 404);
  if (!UUID.test(typeId)) return json({ error: "bad_reservation_type" }, 400);

  const db = serviceClient();
  const byIp = await rateLimit(db, `upgrade:ip:${clientIp(req)}`, PER_IP.limit, PER_IP.windowSeconds);
  if (!byIp.allowed) return json({ error: "rate_limited", retry_after: byIp.retryAfter }, 429);
  const byPass = await rateLimit(db, `upgrade:pass:${token}`, PER_PASS.limit, PER_PASS.windowSeconds);
  if (!byPass.allowed) return json({ error: "rate_limited", retry_after: byPass.retryAfter }, 429);

  // Capacity, platter stock, eligibility and pricing all happen inside the RPC,
  // under the event's capacity lock.
  const { data, error } = await db.rpc("start_reservation_upgrade", {
    p_token: token, p_reservation_type_id: typeId,
  });
  if (error) {
    console.error(JSON.stringify({ msg: "upgrade start failed", detail: error.message }));
    return json({ error: "upgrade_failed" }, 500);
  }
  const r: any = data;
  if (r?.result !== "created") {
    const code = r?.result ?? "upgrade_rejected";
    const status = code === "not_found" ? 404 : CONFLICTS.has(code) ? 409 : 400;
    return json({ error: code, ...(code === "full" ? { remaining: r?.remaining } : {}),
      ...(code === "preorder_sold_out" ? { item: r?.item } : {}) }, status);
  }

  const secret = Deno.env.get("PAYSTACK_SECRET_KEY")?.trim();
  const appUrl = Deno.env.get("APP_URL")?.trim()?.replace(/\/$/, "");
  const giveUp = async () => {
    await db.from("orders").update({ status: "failed" }).eq("id", r.order_id).eq("status", "pending");
    await db.from("reservation_upgrades").update({ status: "failed" }).eq("order_id", r.order_id);
  };
  if (!secret || !appUrl) {
    await giveUp();
    return json({ error: "paystack_misconfigured" }, 500);
  }

  const reference = `MT${crypto.randomUUID().replaceAll("-", "")}`;
  const { error: refErr } = await db.from("orders")
    .update({ paystack_reference: reference, payment_provider: "paystack" }).eq("id", r.order_id);
  if (refErr) {
    await giveUp();
    return json({ error: "order_correlation_failed" }, 500);
  }

  try {
    const init = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: r.email, amount: Math.round(Number(r.amount_kes) * 100), currency: "KES", reference,
        // Paystack appends ?reference=…; the pass token is deliberately NOT in
        // this URL or the metadata — it never leaves our own pages.
        callback_url: `${returnBase(req, appUrl)}/upgrade/complete`,
        metadata: { order_id: r.order_id, reservation_id: r.reservation_id, kind: "table_upgrade" },
      }),
    });
    const response: any = await init.json();
    if (!init.ok || response?.status !== true || !response?.data?.authorization_url || response?.data?.reference !== reference) {
      throw new Error(response?.message ?? `Paystack returned HTTP ${init.status}`);
    }
    console.log(JSON.stringify({ msg: "upgrade started", number: r.reservation_number, type: r.type_name, amount: r.amount_kes }));
    return json({
      reservation_number: r.reservation_number,
      type_name: r.type_name,
      party_size: r.party_size,
      amount_kes: Number(r.amount_kes),
      authorizationUrl: response.data.authorization_url,
      accessCode: response.data.access_code,
      reference,
    });
  } catch (e) {
    await giveUp();
    console.error(JSON.stringify({ msg: "upgrade paystack init failed", detail: String(e).slice(0, 200) }));
    return json({ error: "paystack_init_failed" }, 502);
  }
});
