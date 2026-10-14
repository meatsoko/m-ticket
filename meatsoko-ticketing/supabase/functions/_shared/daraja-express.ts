// Safaricom Daraja M-Pesa Express (STK push + STK Push Query) for MeatSoko's own
// till — migration 20261008120000. Separate from the legacy _shared/daraja.ts
// (paid-ticket checkout, hidden), which it leaves untouched.
//
// Two collection accounts (migration 20261014150000):
//   main  — the ticket till. Secrets: DARAJA_ENV (production | sandbox),
//           DARAJA_CONSUMER_KEY, DARAJA_CONSUMER_SECRET, DARAJA_PASSKEY,
//           DARAJA_SHORTCODE (for a till: the STORE number, used as
//           BusinessShortCode and in the password), DARAJA_TILL_NUMBER (the till
//           that receives the money; defaults to the shortcode), optional
//           DARAJA_TRANSACTION_TYPE (default CustomerBuyGoodsOnline).
//           DARAJA_PAYMENTS=on opens payments (fails closed).
//   sales — the separate vendor-sales collection till/paybill (cashless booths).
//           The same names with DARAJA_SALES_ in front. DARAJA_SALES_ENV and the
//           consumer key/secret fall back to the main ones (one Daraja app can
//           hold both shortcodes); shortcode, passkey and till never fall back,
//           so vendor money can't land in the ticket till by a missing secret.
//           VENDOR_SALES=on opens it (_shared/vendor-sales.ts).
//
// The STK callback comes back to the stk-result function. It is unsigned, so it
// is never believed: queryStk() asks Safaricom itself.

export type DarajaAccount = "main" | "sales";

const BASE: Record<string, string> = { production: "https://api.safaricom.co.ke", sandbox: "https://sandbox.safaricom.co.ke" };

const env = (name: string) => (Deno.env.get(name) ?? "").trim();
/** A setting for `account`; `shared` settings fall back to the main account's. */
const cfg = (account: DarajaAccount, name: string, shared = false) =>
  account === "main" ? env(`DARAJA_${name}`) : env(`DARAJA_SALES_${name}`) || (shared ? env(`DARAJA_${name}`) : "");
const base = (account: DarajaAccount = "main") => BASE[cfg(account, "ENV", true) || "production"] ?? null;

export const darajaOpen = () => env("DARAJA_PAYMENTS").toLowerCase() === "on";

export function darajaConfigured(account: DarajaAccount = "main"): { ok: true } | { ok: false; missing: string[] } {
  const p = account === "main" ? "DARAJA_" : "DARAJA_SALES_";
  const missing = [
    !cfg(account, "CONSUMER_KEY", true) && `${p}CONSUMER_KEY`, !cfg(account, "CONSUMER_SECRET", true) && `${p}CONSUMER_SECRET`,
    !cfg(account, "PASSKEY") && `${p}PASSKEY`, !cfg(account, "SHORTCODE") && `${p}SHORTCODE`, !env("SUPABASE_URL") && "SUPABASE_URL",
  ].filter(Boolean) as string[];
  if (!base(account)) missing.push(`${p}ENV (production|sandbox)`);
  return missing.length ? { ok: false, missing } : { ok: true };
}

// Tokens live ~1 hour; reuse one per isolate until a minute before it expires.
// One cache entry per app (base URL + consumer key), so two accounts on one app share it.
const tokens = new Map<string, { value: string; until: number }>();
async function accessToken(account: DarajaAccount): Promise<string> {
  const key = cfg(account, "CONSUMER_KEY", true), secret = cfg(account, "CONSUMER_SECRET", true);
  const slot = `${base(account)}|${key}`;
  const hit = tokens.get(slot);
  if (hit && Date.now() < hit.until) return hit.value;
  const res = await fetch(`${base(account)}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${btoa(`${key}:${secret}`)}` },
    signal: AbortSignal.timeout(10_000),
  });
  const body: any = await res.json().catch(() => null);
  if (!res.ok || !body?.access_token) throw new Error(`daraja_oauth_failed:${res.status}`);
  tokens.set(slot, { value: body.access_token, until: Date.now() + (Number(body.expires_in ?? 3599) - 60) * 1000 });
  return body.access_token;
}

/** Daraja wants yyyyMMddHHmmss in Nairobi time. */
function timestamp(): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}${p.month}${p.day}${p.hour === "24" ? "00" : p.hour}${p.minute}${p.second}`;
}
const password = (account: DarajaAccount, ts: string) => btoa(`${cfg(account, "SHORTCODE")}${cfg(account, "PASSKEY")}${ts}`);

/** Where Safaricom sends the result. No "mpesa" in the URL: Safaricom refuses such callback URLs. */
export const stkResultUrl = () => `${env("SUPABASE_URL").replace(/\/+$/, "")}/functions/v1/stk-result`;

export async function darajaStkPush(o: { amountKes: number; phone: string; accountRef: string; description: string; account?: DarajaAccount }):
  Promise<{ ok: true; checkoutRequestId: string; merchantRequestId: string | null } | { ok: false; detail: string }> {
  try {
    const account = o.account ?? "main";
    const type = cfg(account, "TRANSACTION_TYPE") || "CustomerBuyGoodsOnline";
    const shortcode = cfg(account, "SHORTCODE");
    const partyB = type === "CustomerBuyGoodsOnline" ? cfg(account, "TILL_NUMBER") || shortcode : shortcode;
    const ts = timestamp();
    const res = await fetch(`${base(account)}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await accessToken(account)}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        BusinessShortCode: shortcode, Password: password(account, ts), Timestamp: ts, TransactionType: type,
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
 * ResultCodes that mean the payment definitely did NOT happen. Anything else
 * that isn't 0 — notably 4999 "The transaction is still under processing",
 * which the query returns while the payer is still entering their PIN — is
 * treated as pending and asked again (2026-10-07: treating every non-zero code
 * as a failure marked a real, paid KSh 1 test as failed).
 */
const FAILED_CODES = new Set([
  "1",      // insufficient funds
  "1001",   // subscriber busy / unable to lock
  "1019",   // transaction expired
  "1025",   // error sending the push request
  "1032",   // cancelled by the user
  "1037",   // no response from the phone (timeout / unreachable)
  "2001",   // wrong PIN
  "9999",   // error sending the push request
]);

/**
 * Safaricom's answer for one STK push: success (ResultCode 0), failed (one of
 * FAILED_CODES), or pending (4999 / "being processed" / any code we don't know).
 * Anything else (throttled, misconfigured) throws, so nothing is decided on it.
 */
export async function queryStk(checkoutRequestId: string, account: DarajaAccount = "main"): Promise<{ state: "success" | "failed" | "pending"; code: string | null; desc: string | null }> {
  const ts = timestamp();
  const res = await fetch(`${base(account)}/mpesa/stkpushquery/v1/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken(account)}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({ BusinessShortCode: cfg(account, "SHORTCODE"), Password: password(account, ts), Timestamp: ts, CheckoutRequestID: checkoutRequestId }),
  });
  const body: any = await res.json().catch(() => null);
  if (body?.ResultCode !== undefined && body?.ResultCode !== null && String(body?.ResponseCode ?? "0") === "0") {
    const code = String(body.ResultCode);
    const state = code === "0" ? "success" : FAILED_CODES.has(code) ? "failed" : "pending";
    return { state, code, desc: body.ResultDesc ?? null };
  }
  if (String(body?.errorCode ?? "") === "500.001.1001" || /being processed/i.test(String(body?.errorMessage ?? ""))) {
    return { state: "pending", code: null, desc: body?.errorMessage ?? null };
  }
  throw new Error(`daraja_query_unavailable:${res.status}:${String(body?.errorCode ?? body?.errorMessage ?? "").slice(0, 80)}`);
}
