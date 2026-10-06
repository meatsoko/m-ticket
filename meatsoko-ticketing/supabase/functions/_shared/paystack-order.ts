// Open a Paystack payment for an event order that already exists (pending):
// attach an "MT…" reference to the order and initialise the transaction.
// Shared by table upgrades and platter add-ons, which differ only in their
// failure bookkeeping (onFail) and their return page.
//
// The pass token is never put in the callback URL or the metadata — it never
// leaves our own pages.
import { returnBase } from "./return-url.ts";
import { paystackPaused } from "./paystack-switch.ts";

export type OpenedPayment =
  | { ok: true; authorizationUrl: string; accessCode: string; reference: string }
  | { ok: false; status: number; error: string };

export async function openOrderPayment(db: any, req: Request, o: {
  orderId: string; email: string; amountKes: number; callbackPath: string;
  metadata: Record<string, unknown>; onFail: () => Promise<void>; logLabel: string;
}): Promise<OpenedPayment> {
  const secret = Deno.env.get("PAYSTACK_SECRET_KEY")?.trim();
  const appUrl = Deno.env.get("APP_URL")?.trim()?.replace(/\/$/, "");
  const giveUp = async () => {
    await db.from("orders").update({ status: "failed" }).eq("id", o.orderId).eq("status", "pending");
    await o.onFail();
  };
  if (paystackPaused()) { await giveUp(); return { ok: false, status: 503, error: "payments_paused" }; }
  if (!secret || !appUrl) { await giveUp(); return { ok: false, status: 500, error: "paystack_misconfigured" }; }

  const reference = `MT${crypto.randomUUID().replaceAll("-", "")}`;
  const { error: refErr } = await db.from("orders")
    .update({ paystack_reference: reference, payment_provider: "paystack" }).eq("id", o.orderId);
  if (refErr) { await giveUp(); return { ok: false, status: 500, error: "order_correlation_failed" }; }

  try {
    const init = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: o.email, amount: Math.round(Number(o.amountKes) * 100), currency: "KES", reference,
        callback_url: `${returnBase(req, appUrl)}${o.callbackPath}`,
        metadata: o.metadata,
      }),
    });
    const response: any = await init.json();
    if (!init.ok || response?.status !== true || !response?.data?.authorization_url || response?.data?.reference !== reference) {
      throw new Error(response?.message ?? `Paystack returned HTTP ${init.status}`);
    }
    return { ok: true, authorizationUrl: response.data.authorization_url, accessCode: response.data.access_code, reference };
  } catch (e) {
    await giveUp();
    console.error(JSON.stringify({ msg: `${o.logLabel} paystack init failed`, detail: String(e).slice(0, 200) }));
    return { ok: false, status: 502, error: "paystack_init_failed" };
  }
}
