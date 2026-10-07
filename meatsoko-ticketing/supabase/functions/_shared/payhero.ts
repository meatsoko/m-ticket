// M-Pesa STK payments alongside Paystack: PayHero (migration 20261008090000) and
// Daraja M-Pesa Express to MeatSoko's own till (migration 20261008120000). Both
// share the ledger (payhero_payments) and the confirm_payhero_* functions; only
// verification differs (verifyMpesa below). Shared by payhero-pay, payhero-status,
// payhero-callback, stk-result and payhero-reconcile. The PayHero client is here;
// the Daraja client is _shared/daraja-express.ts.
//
// Trust model: PayHero's callback is not signed, so nothing here ever believes a
// caller. The only thing that confirms money is verifyMpesa(), which asks
// PayHero's own transaction-status API about a payment we started, and then
// runs one of the confirm_payhero_* functions (idempotent, under row locks).
//
// Secrets (Supabase): PAYHERO_API_USERNAME + PAYHERO_API_PASSWORD (or one
// PAYHERO_BASIC_AUTH = "Basic …"), PAYHERO_CHANNEL_ID, and PAYHERO_PAYMENTS=on
// to open payments (anything else = closed; verifying earlier payments still runs).
import { serviceClient } from "./supabase.ts";
import { buildAndSend } from "./reservation-email.ts";
import { notifyMerchOrder, sendMerchOrderEmail } from "./merch.ts";
import { sendVendorEmail, VENDOR_TYPES } from "./vendor.ts";
import { escapeHtml as esc, sendEmail } from "./resend.ts";
import { queryStk } from "./daraja-express.ts";

type Db = ReturnType<typeof serviceClient>;
export type PayheroKind = "event" | "vendor" | "merch";

export const PAYHERO_REFERENCE = /^PH[a-f0-9]{32}$/;
const DARAJA_GIVE_UP_MS = 30 * 60 * 1000;
export const newPayheroReference = () => `PH${crypto.randomUUID().replaceAll("-", "")}`;

const api = () => (Deno.env.get("PAYHERO_API_URL") ?? "https://backend.payhero.co.ke/api/v2").trim().replace(/\/+$/, "");

/** Fails closed: payments open only when PAYHERO_PAYMENTS is exactly "on". */
export const payheroOpen = () => Deno.env.get("PAYHERO_PAYMENTS")?.trim().toLowerCase() === "on";

function authHeader(): string | null {
  const basic = Deno.env.get("PAYHERO_BASIC_AUTH")?.trim();
  if (basic) return basic.startsWith("Basic ") ? basic : `Basic ${basic}`;
  const user = Deno.env.get("PAYHERO_API_USERNAME")?.trim();
  const pass = Deno.env.get("PAYHERO_API_PASSWORD")?.trim();
  return user && pass ? `Basic ${btoa(`${user}:${pass}`)}` : null;
}

export function payheroConfigured(): { ok: true } | { ok: false; missing: string[] } {
  const missing = [
    !authHeader() && "PAYHERO_API_USERNAME/PAYHERO_API_PASSWORD",
    !Number.isInteger(Number(Deno.env.get("PAYHERO_CHANNEL_ID"))) || !Deno.env.get("PAYHERO_CHANNEL_ID") ? "PAYHERO_CHANNEL_ID" : null,
    !Deno.env.get("SUPABASE_URL") && "SUPABASE_URL",
  ].filter(Boolean) as string[];
  return missing.length ? { ok: false, missing } : { ok: true };
}

/** Ask PayHero to send the STK prompt. Our reference goes as external_reference. */
export async function sendStkPush(o: { reference: string; amountKes: number; phone: string; customerName: string }):
  Promise<{ ok: true; payheroReference: string | null; checkoutRequestId: string | null } | { ok: false; detail: string }> {
  const auth = authHeader();
  if (!auth) return { ok: false, detail: "payhero_misconfigured" };
  const callback = `${Deno.env.get("SUPABASE_URL")!.replace(/\/+$/, "")}/functions/v1/payhero-callback`;
  try {
    const res = await fetch(`${api()}/payments`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        amount: Math.round(o.amountKes), phone_number: o.phone, channel_id: Number(Deno.env.get("PAYHERO_CHANNEL_ID")),
        provider: "m-pesa", external_reference: o.reference, customer_name: o.customerName.slice(0, 60),
        callback_url: callback,
      }),
    });
    const body: any = await res.json().catch(() => null);
    if (!res.ok || body?.success !== true) return { ok: false, detail: String(body?.error_message ?? body?.message ?? `HTTP ${res.status}`).slice(0, 200) };
    return { ok: true, payheroReference: body?.reference ?? null, checkoutRequestId: body?.CheckoutRequestID ?? null };
  } catch (e) {
    return { ok: false, detail: String((e as Error)?.message ?? e).slice(0, 200) };
  }
}

/** PayHero's view of a payment: SUCCESS / QUEUED / FAILED (anything else is treated as not final). */
async function fetchStatus(payheroReference: string): Promise<{ status: string; receipt: string | null; amount: number | null; desc: string | null }> {
  const auth = authHeader();
  if (!auth) throw new Error("payhero_misconfigured");
  const res = await fetch(`${api()}/transaction-status?reference=${encodeURIComponent(payheroReference)}`, {
    headers: { Authorization: auth }, signal: AbortSignal.timeout(15_000),
  });
  const body: any = await res.json().catch(() => null);
  if (!res.ok || !body) throw new Error(`payhero_status_unavailable:${res.status}`);
  const amount = Number(body.amount);
  return {
    status: String(body.status ?? "").toUpperCase(),
    receipt: body.provider_reference ?? body.third_party_reference ?? null,
    amount: Number.isFinite(amount) && amount > 0 ? amount : null,
    desc: body.result_desc ?? body.ResultDesc ?? body.message ?? null,
  };
}

export type Ledger = {
  id: string; reference: string; kind: PayheroKind; provider: "payhero" | "daraja"; status: "queued" | "success" | "failed"; outcome: string | null;
  order_id: string | null; vendor_application_id: string | null; merch_order_id: string | null;
  amount_kes: number; payhero_reference: string | null; checkout_request_id: string | null; mpesa_receipt: string | null; created_at: string;
};
const LEDGER = "id,reference,kind,provider,status,outcome,order_id,vendor_application_id,merch_order_id,amount_kes,payhero_reference,checkout_request_id,mpesa_receipt,created_at";

export async function loadLedger(db: Db, reference: string): Promise<Ledger | null> {
  const { data } = await db.from("payhero_payments").select(LEDGER).eq("reference", reference).maybeSingle();
  return (data as Ledger) ?? null;
}

/**
 * Ask the provider about one of our payments and act on the answer. Idempotent:
 * success runs confirm_payhero_<kind> (a second call returns "already"); a
 * failure releases the order; still pending changes nothing.
 *   PayHero: its transaction-status API (by PayHero's reference).
 *   Daraja:  Safaricom's STK Push Query (by CheckoutRequestID). It returns no
 *            receipt or amount: the receipt is the one the callback stored (it
 *            is only a label), the amount is what we asked Safaricom to charge.
 */
export async function verifyMpesa(db: Db, reference: string): Promise<{ status: string; result?: string; detail?: Record<string, unknown> }> {
  if (!PAYHERO_REFERENCE.test(reference)) throw new Error("invalid_reference");
  const row = await loadLedger(db, reference);
  if (!row) throw new Error("unknown_reference");
  if (row.status !== "queued") return { status: row.status, result: row.outcome ?? undefined };

  let s: { status: string; receipt: string | null; amount: number | null; desc: string | null };
  if (row.provider === "daraja") {
    if (!row.checkout_request_id) return { status: "queued" };   // STK not accepted yet
    const q = await queryStk(row.checkout_request_id);
    // An STK prompt expires within minutes: still "pending" after 30 is a dead prompt.
    const expired = q.state === "pending" && Date.now() - Date.parse(row.created_at) > DARAJA_GIVE_UP_MS;
    s = { status: q.state === "success" ? "SUCCESS" : q.state === "failed" || expired ? "FAILED" : "QUEUED",
          receipt: row.mpesa_receipt, amount: null, desc: expired ? `expired: ${q.desc ?? q.code ?? "no answer"}` : q.desc ?? q.code };
  } else {
    if (!row.payhero_reference) return { status: "queued" };   // STK not accepted yet
    s = await fetchStatus(row.payhero_reference);
  }
  if (s.status === "QUEUED" || s.status === "PENDING" || s.status === "") return { status: "queued" };
  if (s.status !== "SUCCESS") {
    await db.rpc("fail_payhero_payment", { p_reference: reference, p_reason: s.desc ?? s.status });
    console.log(JSON.stringify({ msg: "mpesa payment failed", provider: row.provider, ref: reference.slice(0, 10), kind: row.kind, status: s.status }));
    return { status: "failed" };
  }

  // The amount the provider reports if it gives one; otherwise the amount we
  // asked for (we set it server-side when starting the STK push).
  const amount = s.amount ?? Number(row.amount_kes);
  const fn = row.kind === "event" ? "confirm_payhero_event_payment"
    : row.kind === "vendor" ? "confirm_payhero_vendor_payment" : "confirm_payhero_merch_payment";
  const { data, error } = await db.rpc(fn, { p_reference: reference, p_amount_kes: amount, p_receipt: s.receipt });
  if (error) throw new Error(`confirmation_failed:${error.message}`);
  const r: any = data;
  if (r?.result === "confirmed") await afterConfirmed(db, row.kind, r);
  else console.error(JSON.stringify({ msg: "mpesa paid but not applied — needs a human", provider: row.provider, ref: reference.slice(0, 10), kind: row.kind, result: r?.result }));
  return { status: "success", result: r?.result, detail: r };
}

/** The same emails the Paystack path sends once money is confirmed. */
async function afterConfirmed(db: Db, kind: PayheroKind, r: any) {
  try {
    if (kind === "event") {
      const appUrl = (Deno.env.get("APP_URL") ?? "").trim();
      if (appUrl && r.reservation_id) await buildAndSend(db, r.reservation_id, appUrl);
    } else if (kind === "vendor") {
      await Promise.all([sendVendorEmail(db, r.id), notifyVendorOrganiser(db, r.id)]);
    } else {
      await Promise.all([sendMerchOrderEmail(db, r.order_id), notifyMerchOrder(db, r.order_id)]);
    }
  } catch (e) {
    console.error(JSON.stringify({ msg: "payhero confirmation email failed", kind, detail: String(e).slice(0, 160) }));
  }
}

/** Organiser alert for a vendor paid through PayHero (the Paystack one lives in vendor.ts). */
async function notifyVendorOrganiser(db: Db, id: string) {
  const { data: v }: any = await db.from("vendor_applications")
    .select("reference_number,name,phone,email,vendor_type,description,amount_kes,events(name,notify_email)").eq("id", id).maybeSingle();
  const to = String(v?.events?.notify_email ?? "").split(",").map((s: string) => s.trim()).filter(Boolean);
  if (!v || !to.length) return { sent: false, reason: "no_notify_email" };
  const text = [`New paid vendor: ${v.name} (${VENDOR_TYPES[v.vendor_type] ?? v.vendor_type})`, `Registration ${v.reference_number}`,
    `Phone 0${String(v.phone).slice(3)} · ${v.email}`, v.description ? `About: ${v.description}` : "",
    `Paid KSh ${Math.round(Number(v.amount_kes)).toLocaleString("en-KE")} by M-Pesa (PayHero)`].filter(Boolean).join("\n");
  return sendEmail({ to, subject: `New vendor: ${v.name} — ${v.events?.name ?? ""}`, html: `<pre style="font-family:system-ui,sans-serif;font-size:14px">${esc(text)}</pre>`, text });
}
