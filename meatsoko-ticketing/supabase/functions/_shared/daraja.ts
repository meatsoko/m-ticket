// M-Pesa Daraja client (reused MeatSoko production credentials — SRS A1)
const BASE = {
  sandbox: "https://sandbox.safaricom.co.ke",
  production: "https://api.safaricom.co.ke",
} as const;

const OAUTH_TIMEOUT_MS = 10_000;
const STK_TIMEOUT_MS = 20_000;

/**
 * Read a secret and strip surrounding whitespace.
 *
 * Secrets set from an .env file or pasted into the dashboard routinely pick up a
 * trailing newline. Daraja fails in two different and equally opaque ways when that
 * happens: a padded passkey yields "Wrong credentials", and a padded CallBackURL makes
 * Safaricom's WAF drop the request with no response at all (the STK call hangs until the
 * edge function is killed). Trim here so neither can ever reach the wire.
 */
function env(name: string, required = true): string {
  const raw = Deno.env.get(name);
  const value = (raw ?? "").trim();
  if (!value && required) throw new Error(`Daraja misconfigured: ${name} is not set`);
  if (raw !== undefined && raw !== value) {
    console.warn(`daraja: ${name} had surrounding whitespace — trimmed`);
  }
  return value;
}

function base() {
  const mode = env("DARAJA_ENV", false) || "sandbox";
  const url = BASE[mode as keyof typeof BASE];
  if (!url) throw new Error(`Daraja misconfigured: DARAJA_ENV must be sandbox|production, got "${mode}"`);
  return url;
}

function callbackUrl(): string {
  const raw = env("DARAJA_CALLBACK_URL");
  let parsed: URL;
  try { parsed = new URL(raw); } catch {
    throw new Error("Daraja misconfigured: DARAJA_CALLBACK_URL is not a valid URL");
  }
  // SRS A2: the callback must be publicly reachable HTTPS.
  if (parsed.protocol !== "https:") {
    throw new Error("Daraja misconfigured: DARAJA_CALLBACK_URL must be https");
  }
  return parsed.toString();
}

/**
 * Config health for logging: presence, length and mode only — never a value, not even
 * truncated. A missing or blank secret is the difference between "Daraja rejected us" and
 * "we never had credentials", and that distinction is otherwise invisible in the logs.
 */
export function describeDarajaConfig(): {
  mode: string;
  callback_host: string | null;
  lengths: Record<string, number>;
  missing: string[];
} {
  const required = [
    "DARAJA_CONSUMER_KEY",
    "DARAJA_CONSUMER_SECRET",
    "DARAJA_SHORTCODE",
    "DARAJA_PASSKEY",
    "DARAJA_CALLBACK_URL",
  ];
  const lengths: Record<string, number> = {};
  const missing: string[] = [];
  for (const name of required) {
    const v = (Deno.env.get(name) ?? "").trim();
    lengths[name] = v.length;
    if (!v) missing.push(name);
  }

  let callbackHost: string | null = null;
  const rawCb = (Deno.env.get("DARAJA_CALLBACK_URL") ?? "").trim();
  if (rawCb) {
    try { callbackHost = new URL(rawCb).host; } catch { callbackHost = "invalid-url"; }
  }

  return {
    mode: (Deno.env.get("DARAJA_ENV") ?? "sandbox").trim(),
    callback_host: callbackHost,
    lengths,
    missing,
  };
}

/** Daraja tokens live ~3600s. Cache per isolate so the gate isn't paying for an extra round trip. */
let cachedToken: { value: string; expiresAt: number } | null = null;

export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;

  const key = env("DARAJA_CONSUMER_KEY");
  const secret = env("DARAJA_CONSUMER_SECRET");
  const res = await fetch(
    `${base()}/oauth/v1/generate?grant_type=client_credentials`,
    {
      headers: { Authorization: `Basic ${btoa(`${key}:${secret}`)}` },
      signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
    }
  );
  if (!res.ok) throw new Error(`Daraja oauth failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  if (!data.access_token) throw new Error(`Daraja oauth returned no token: ${JSON.stringify(data)}`);

  const ttl = Number(data.expires_in ?? 3599);
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (ttl - 60) * 1000 };
  return cachedToken.value;
}

/** Daraja wants the timestamp in Nairobi local time, not UTC. */
function timestamp(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const p = (type: string) => parts.find((x) => x.type === type)!.value;
  return `${p("year")}${p("month")}${p("day")}${p("hour")}${p("minute")}${p("second")}`;
}

export async function initiateStk(opts: {
  phone: string; // 2547XXXXXXXX
  amount: number;
  accountRef: string;
  description: string;
}): Promise<{ checkoutRequestId: string; merchantRequestId: string }> {
  const shortcode = env("DARAJA_SHORTCODE");
  const passkey = env("DARAJA_PASSKEY");
  // Paybill vs till (till numbers need CustomerBuyGoodsOnline).
  const transactionType = env("DARAJA_TRANSACTION_TYPE", false) || "CustomerPayBillOnline";
  const callback = callbackUrl();

  const amount = Math.round(opts.amount);
  if (!Number.isFinite(amount) || amount < 1) {
    throw new Error(`Daraja rejects non-positive amounts (got ${opts.amount})`);
  }
  if (!/^2547\d{8}$/.test(opts.phone)) {
    throw new Error(`Daraja rejects malformed MSISDN "${opts.phone}"`);
  }

  const ts = timestamp();
  const password = btoa(`${shortcode}${passkey}${ts}`);

  const token = await getAccessToken();
  let res: Response;
  try {
    res = await fetch(`${base()}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(STK_TIMEOUT_MS),
      body: JSON.stringify({
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: ts,
        TransactionType: transactionType,
        Amount: amount,
        PartyA: opts.phone,
        PartyB: shortcode,
        PhoneNumber: opts.phone,
        CallBackURL: callback,
        AccountReference: opts.accountRef.slice(0, 12),
        TransactionDesc: opts.description.slice(0, 13),
      }),
    });
  } catch (e) {
    // Never let a stalled Daraja connection hold the request open: the buyer would sit on a
    // spinner while the order row stays `pending` with no checkout id to reconcile against.
    throw new Error(`Daraja unreachable: ${e instanceof Error ? e.message : String(e)}`);
  }

  const raw = await res.text();
  let data: any;
  try { data = JSON.parse(raw); } catch {
    throw new Error(`Daraja returned non-JSON (${res.status}): ${raw.slice(0, 200)}`);
  }
  if (!res.ok || data.ResponseCode !== "0") {
    throw new Error(`STK rejected: ${JSON.stringify(data)}`);
  }
  if (!data.CheckoutRequestID) {
    throw new Error(`STK accepted but returned no CheckoutRequestID: ${JSON.stringify(data)}`);
  }
  return {
    checkoutRequestId: data.CheckoutRequestID,
    merchantRequestId: data.MerchantRequestID,
  };
}
