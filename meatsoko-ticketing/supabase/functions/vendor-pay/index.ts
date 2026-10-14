// Cashless booth payments (migration 20261014150000). Public, rate-limited; the
// pay page /pay/<code> is the only caller.
//
//   { action: "info",   code }  -> { vendor_name, event_name, venue, open, reason? }
//   { action: "start",  code, amount, phone, idempotency_key }
//        -> { reference, status_token, status }   (STK prompt sent to `phone`)
//   { action: "status", status_token } -> { status, reference, amount_kes, vendor_name, ... }
//
// Attribution, amount limits and the commission rate are decided by
// start_vendor_sale() from the QR code alone; the request can't name a vendor or
// an event. Money goes to the SEPARATE sales till (Daraja account "sales"), and a
// sale is successful only when verifyMpesa() has Safaricom's STK Push Query say
// so — never because of a callback or this page.
//
// Idempotency: the page sends a UUID it keeps in localStorage. The same key
// returns the same attempt (no second prompt), so a double tap, a refresh or a
// lost response can't charge twice. A new attempt after a failure uses a new key.
//
// Switch: VENDOR_SALES=on (fails closed) and the DARAJA_SALES_* secrets. For a
// bank paybill, DARAJA_SALES_ACCOUNT_REFERENCE is the account number the bank
// needs on every payment (Daraja accepts at most 12 characters).
import { json, preflight } from "../_shared/cors.ts";
import { clientIp, normalizePhone, rateLimit, serviceClient } from "../_shared/supabase.ts";
import { darajaConfigured, darajaStkPush } from "../_shared/daraja-express.ts";
import { newPayheroReference, verifyMpesa } from "../_shared/payhero.ts";

const CODE = /^[a-z2-7]{16}$/;
const TOKEN = /^[a-f0-9]{32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SALE_COLUMNS = "id,reference,status,status_reason,amount_kes,mpesa_receipt,created_at,paid_at,event_vendor_id,vendors(name),events(name)";

const salesOpen = () => (Deno.env.get("VENDOR_SALES") ?? "").trim().toLowerCase() === "on";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const b = await req.json().catch(() => null);
  if (!b) return json({ error: "bad_json" }, 400);
  const db = serviceClient();
  const ip = clientIp(req);
  const action = String(b.action ?? "");

  if (action === "info") {
    const code = String(b.code ?? "").toLowerCase();
    if (!CODE.test(code)) return json({ error: "unknown_code" }, 404);
    const rl = await rateLimit(db, `vendor-pay:info:${ip}`, 120, 600);
    if (!rl.allowed) return json({ error: "rate_limited", retry_after: rl.retryAfter }, 429);
    const { data: qr }: any = await db.from("vendor_qr_codes")
      .select("active,event_vendors(status,commission_bps,policy_bps_accepted,vendors(name,status),events(name,venue,status,starts_at,ends_at,vendor_commission_bps))")
      .eq("code", code).maybeSingle();
    if (!qr) return json({ error: "unknown_code" }, 404);
    const ev = qr.event_vendors, e = ev?.events;
    return json({
      vendor_name: ev?.vendors?.name ?? "", event_name: e?.name ?? "", venue: e?.venue ?? null,
      ...closedReason(qr, ev, e),
    });
  }

  if (action === "start") {
    const code = String(b.code ?? "").toLowerCase();
    if (!CODE.test(code)) return json({ error: "unknown_code" }, 404);
    if (!salesOpen()) return json({ error: "payments_closed" }, 503);
    const ready = darajaConfigured("sales");
    if (!ready.ok) {
      console.error(JSON.stringify({ msg: "vendor sales till not configured", missing: ready.missing }));
      return json({ error: "payments_closed" }, 503);
    }
    const phone = normalizePhone(String(b.phone ?? ""));
    if (!phone) return json({ error: "invalid_phone" }, 400);
    const amount = Number(b.amount);
    if (!Number.isInteger(amount) || amount < 1 || amount > 150_000) return json({ error: "invalid_amount" }, 400);
    const key = String(b.idempotency_key ?? "");
    if (!UUID.test(key)) return json({ error: "idempotency_key_required" }, 400);

    for (const [bucket, limit] of [[`vendor-pay:start:ip:${ip}`, 30], [`vendor-pay:start:phone:${phone}`, 10]] as const) {
      const rl = await rateLimit(db, bucket, limit, 600);
      if (!rl.allowed) return json({ error: "rate_limited", retry_after: rl.retryAfter }, 429);
    }

    const { data, error } = await db.rpc("start_vendor_sale", { p_code: code, p_amount_kes: amount, p_phone: phone, p_idempotency_key: key });
    if (error) return json({ error: "server_error" }, 500);
    const r: any = data;
    if (r?.error) return json({ error: r.error }, r.error === "unknown_code" ? 404 : 409);
    const sale = r.sale;
    if (r.result === "existing") return json(await view(db, sale.status_token));

    // A new attempt: open the ledger row, then send the prompt to the sales till.
    const reference = newPayheroReference();
    const { error: lErr } = await db.from("payhero_payments").insert({
      reference, kind: "sale", provider: "daraja", account: "sales", vendor_sale_id: sale.id, phone, amount_kes: amount,
    });
    if (lErr) {
      console.error(JSON.stringify({ msg: "vendor sale ledger insert failed", sale: sale.reference, detail: lErr.message }));
      return json({ error: "server_error" }, 500);
    }
    const stk = await darajaStkPush({
      account: "sales", amountKes: amount, phone,
      // A bank paybill routes on the account number: DARAJA_SALES_ACCOUNT_REFERENCE
      // (the bank's account reference for MeatSoko) when set, else the sale reference.
      accountRef: (Deno.env.get("DARAJA_SALES_ACCOUNT_REFERENCE") ?? "").trim() || sale.reference.replace(/[^A-Za-z0-9]/g, "").slice(0, 12),
      description: String(r.vendor_name ?? "Vendor").replace(/[^A-Za-z0-9 ]/g, "").slice(0, 13) || "Vendor",
    });
    if (!stk.ok) {
      await db.rpc("fail_payhero_payment", { p_reference: reference, p_reason: `stk_not_sent: ${stk.detail}` });
      console.log(JSON.stringify({ msg: "vendor sale stk refused", sale: sale.reference, detail: stk.detail }));
      return json({ error: "stk_failed", ...(await view(db, sale.status_token)) }, 502);
    }
    await db.from("payhero_payments").update({
      checkout_request_id: stk.checkoutRequestId, merchant_request_id: stk.merchantRequestId, updated_at: new Date().toISOString(),
    }).eq("reference", reference);
    console.log(JSON.stringify({ msg: "vendor sale prompt sent", sale: sale.reference, amount }));
    return json(await view(db, sale.status_token));
  }

  if (action === "status") {
    const token = String(b.status_token ?? "").toLowerCase();
    if (!TOKEN.test(token)) return json({ error: "not_found" }, 404);
    const rl = await rateLimit(db, `vendor-pay:status:${ip}`, 240, 600);
    if (!rl.allowed) return json({ error: "rate_limited", retry_after: rl.retryAfter }, 429);
    const { data: sale }: any = await db.from("vendor_sales").select("id,status,created_at").eq("status_token", token).maybeSingle();
    if (!sale) return json({ error: "not_found" }, 404);
    if (sale.status === "pending" && Date.now() - Date.parse(sale.created_at) > 8_000) {
      const { data: pay }: any = await db.from("payhero_payments").select("reference,status").eq("vendor_sale_id", sale.id).maybeSingle();
      if (!pay) {
        await db.rpc("expire_unsent_vendor_sale", { p_sale_id: sale.id });
      } else if (pay.status === "queued") {
        // Safaricom throttles STK Push Query: at most one question every 6 s per sale.
        const ask = await rateLimit(db, `vendor-pay:ask:${pay.reference}`, 1, 6);
        if (ask.allowed) {
          try { await verifyMpesa(db, pay.reference); }
          catch (e) { console.error(JSON.stringify({ msg: "vendor sale status check failed", ref: String(pay.reference).slice(0, 10), detail: String(e).slice(0, 160) })); }
        }
      }
    }
    return json(await view(db, token));
  }

  return json({ error: "unknown_action" }, 400);
});

/** Why the booth can't take payments right now, mirroring start_vendor_sale(). */
function closedReason(qr: any, ev: any, e: any): { open: boolean; reason?: string } {
  const now = Date.now();
  if (!qr.active) return { open: false, reason: "code_inactive" };
  if (ev?.vendors?.status !== "active") return { open: false, reason: "vendor_suspended" };
  if (ev?.status !== "active") return { open: false, reason: "vendor_not_active" };
  if (e?.status !== "live" || now >= Date.parse(e.ends_at)) return { open: false, reason: "event_closed" };
  if (now < Date.parse(e.starts_at)) return { open: false, reason: "event_not_started" };
  if (ev.policy_bps_accepted !== (ev.commission_bps ?? e.vendor_commission_bps)) return { open: false, reason: "vendor_not_active" };
  if (!salesOpen() || !darajaConfigured("sales").ok) return { open: false, reason: "payments_closed" };
  return { open: true };
}

/** The payer's view of their own attempt (no phone, no internal ids). */
async function view(db: any, token: string) {
  const { data: s }: any = await db.from("vendor_sales").select(SALE_COLUMNS).eq("status_token", token).maybeSingle();
  if (!s) return { error: "not_found" };
  return {
    status_token: token, reference: s.reference,
    // flagged = money arrived but needs a person (e.g. paid after it was called failed)
    status: s.status, amount_kes: Number(s.amount_kes), vendor_name: s.vendors?.name ?? "", event_name: s.events?.name ?? "",
    mpesa_receipt: s.status === "success" ? s.mpesa_receipt : null, created_at: s.created_at, paid_at: s.paid_at,
    failure: s.status === "failed" ? failureText(s.status_reason) : null,
  };
}

function failureText(reason: string | null): string {
  const r = String(reason ?? "").toLowerCase();
  if (/cancel/.test(r)) return "The payment was cancelled on the phone.";
  if (/insufficient/.test(r)) return "Not enough money in the M-Pesa account.";
  if (/expired|timeout|no response/.test(r)) return "The M-Pesa prompt timed out.";
  if (/stk_not_sent/.test(r)) return "M-Pesa couldn't send the prompt to this number.";
  return "M-Pesa didn't complete the payment.";
}
