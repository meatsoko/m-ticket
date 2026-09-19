// M-Pesa Daraja client (reused MeatSoko production credentials — SRS A1)
const BASE = {
  sandbox: "https://sandbox.safaricom.co.ke",
  production: "https://api.safaricom.co.ke",
} as const;

function base() {
  return BASE[(Deno.env.get("DARAJA_ENV") ?? "sandbox") as keyof typeof BASE];
}

export async function getAccessToken(): Promise<string> {
  const key = Deno.env.get("DARAJA_CONSUMER_KEY")!;
  const secret = Deno.env.get("DARAJA_CONSUMER_SECRET")!;
  const res = await fetch(
    `${base()}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${btoa(`${key}:${secret}`)}` } }
  );
  if (!res.ok) throw new Error(`Daraja oauth failed: ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

export async function initiateStk(opts: {
  phone: string; // 2547XXXXXXXX
  amount: number;
  accountRef: string;
  description: string;
}): Promise<{ checkoutRequestId: string; merchantRequestId: string }> {
  const shortcode = Deno.env.get("DARAJA_SHORTCODE")!;
  const passkey = Deno.env.get("DARAJA_PASSKEY")!;
  const timestamp = new Date()
    .toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const password = btoa(`${shortcode}${passkey}${timestamp}`);

  const token = await getAccessToken();
  const res = await fetch(`${base()}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: Math.round(opts.amount),
      PartyA: opts.phone,
      PhoneNumber: opts.phone,
      CallBackURL: Deno.env.get("DARAJA_CALLBACK_URL")!,
      AccountReference: opts.accountRef.slice(0, 12),
      TransactionDesc: opts.description.slice(0, 13),
    }),
  });
  const data = await res.json();
  if (!res.ok || data.ResponseCode !== "0") {
    throw new Error(`STK rejected: ${JSON.stringify(data)}`);
  }
  return {
    checkoutRequestId: data.CheckoutRequestID,
    merchantRequestId: data.MerchantRequestID,
  };
}
