// Safaricom Daraja M-Pesa Express (STK push + STK Push Query) for MeatSoko's own
// till — migration 20261008120000. Separate from the legacy _shared/daraja.ts
// (paid-ticket checkout, hidden), which it leaves untouched.
//
// Secrets: DARAJA_ENV (production | sandbox), DARAJA_CONSUMER_KEY,
// DARAJA_CONSUMER_SECRET, DARAJA_PASSKEY, DARAJA_SHORTCODE (for a till: the
// STORE number, used as BusinessShortCode and in the password),
// DARAJA_TILL_NUMBER (the till that receives the money; defaults to the
// shortcode), optional DARAJA_TRANSACTION_TYPE (default CustomerBuyGoodsOnline).
// DARAJA_PAYMENTS=on opens payments (fails closed).
//
// The STK callback comes back to the stk-result function. It is unsigned, so it
// is never believed: queryStk() asks Safaricom itself.

const BASE: Record<string, string> = { production: "https://api.safaricom.co.ke", sandbox: "https://sandbox.safaricom.co.ke" };

const env = (name: string) => (Deno.env.get(name) ?? "").trim();
const base = () => BASE[env("DARAJA_ENV") || "production"] ?? null;

export const darajaOpen = () => env("DARAJA_PAYMENTS").toLowerCase() === "on";

export function darajaConfigured(): { ok: true } | { ok: false; missing: string[] } {
  const missing = ["DARAJA_CONSUMER_KEY", "DARAJA_CONSUMER_SECRET", "DARAJA_PASSKEY", "DARAJA_SHORTCODE", "SUPABASE_URL"].filter((n) => !env(n));
  if (!base()) missing.push("DARAJA_ENV (production|sandbox)");
  return missing.length ? { ok: false, missing } : { ok: true };
}

// Tokens live ~1 hour; reuse one per isolate until a minute before it expires.
let token: { value: string; until: number } | null = null;
async function accessToken(): Promise<string> {
  if (token && Date.now() < token.until) return token.value;
  const res = await fetch(`${base()}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${btoa(`${env("DARAJA_CONSUMER_KEY")}:${env("DARAJA_CONSUMER_SECRET")}`)}` },
    signal: AbortSignal.timeout(10_000),
  });
  const body: any = await res.json().catch(() => null);
  if (!res.ok || !body?.access_token) throw new Error(`daraja_oauth_failed:${res.status}`);
  token = { value: body.access_token, until: Date.now() + (Number(body.expires_in ?? 3599) - 60) * 1000 };
  return token.value;
}

/** Daraja wants yyyyMMddHHmmss in Nairobi time. */
function timestamp(): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}${p.month}${p.day}${p.hour === "24" ? "00" : p.hour}${p.minute}${p.second}`;
}
const password = (ts: string) => btoa(`${env("DARAJA_SHORTCODE")}${env("DARAJA_PASSKEY")}${ts}`);

/** Where Safaricom sends the result. No "mpesa" in the URL: Safaricom refuses such callback URLs. */
export const stkResultUrl = () => `${env("SUPABASE_URL").replace(/\/+$/, "")}/functions/v1/stk-result`;

export async function darajaStkPush(o: { amountKes: number; phone: string; accountRef: string; description: string }):
  Promise<{ ok: true; checkoutRequestId: string; merchantRequestId: string | null } | { ok: false; detail: string }> {
  try {
    const type = env("DARAJA_TRANSACTION_TYPE") || "CustomerBuyGoodsOnline";
    const shortcode = env("DARAJA_SHORTCODE");
    const partyB = type === "CustomerBuyGoodsOnline" ? env("DARAJA_TILL_NUMBER") || shortcode : shortcode;
    const ts = timestamp();
    const res = await fetch(`${base()}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        BusinessShortCode: shortcode, Password: password(ts), Timestamp: ts, TransactionType: type,
        Amount: Math.round(o.amountKes), PartyA: o.phone, PartyB: partyB, PhoneNumber: o.phone,
        CallBackURL: stkResultUrl(), AccountReference: o.accountRef.slice(0, 12), TransactionDesc: o.description.slice(0, 13),
      }),
    });
    const body: any = await res.json().catch(() => null);
    if (!res.ok || String(body?.ResponseCode) !== "0" || !body?.CheckoutRequestID) {
      return { ok: false, detail: String(body?.errorMessage ?? body?.ResponseDescription ?? `HTTP ${res.status}`).slice(0, 200) };
    }
    return { ok: true, checkoutRequestId: body.CheckoutRequestID, merchantRequestId: body.MerchantRequestID ?? null };
  } catch (e) {
    return { ok: false, detail: String((e as Error)?.message ?? e).slice(0, 200) };
  }
}

/**
 * Safaricom's answer for one STK push: success (ResultCode 0), failed (any
 * other ResultCode — 1032 cancelled, 1037 no response, 1 insufficient funds,
 * 2001 wrong PIN…), or pending ("The transaction is being processed").
 * Anything else (throttled, misconfigured) throws, so nothing is decided on it.
 */
export async function queryStk(checkoutRequestId: string): Promise<{ state: "success" | "failed" | "pending"; code: string | null; desc: string | null }> {
  const ts = timestamp();
  const res = await fetch(`${base()}/mpesa/stkpushquery/v1/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({ BusinessShortCode: env("DARAJA_SHORTCODE"), Password: password(ts), Timestamp: ts, CheckoutRequestID: checkoutRequestId }),
  });
  const body: any = await res.json().catch(() => null);
  if (body?.ResultCode !== undefined && body?.ResultCode !== null && String(body?.ResponseCode ?? "0") === "0") {
    const code = String(body.ResultCode);
    return { state: code === "0" ? "success" : "failed", code, desc: body.ResultDesc ?? null };
  }
  if (String(body?.errorCode ?? "") === "500.001.1001" || /being processed/i.test(String(body?.errorMessage ?? ""))) {
    return { state: "pending", code: null, desc: body?.errorMessage ?? null };
  }
  throw new Error(`daraja_query_unavailable:${res.status}:${String(body?.errorCode ?? body?.errorMessage ?? "").slice(0, 80)}`);
}
