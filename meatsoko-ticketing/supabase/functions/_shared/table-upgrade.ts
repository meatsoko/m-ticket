// Start paying for a table upgrade of a General Admission booking (migration
// 20260929180000). Shared by upgrade-reservation (from the pass page) and reserve
// (a new guest choosing a table straight away).
//
// The caller must already hold the booking's access_token legitimately: the pass
// holder, or reserve for a booking it has just CREATED in the same request. It is
// never derived from a phone number or email.
//
// This only opens a Paystack payment. The booking changes when
// confirm_paystack_payment sees the money; a failed or cancelled payment leaves it
// as General Admission.
import { returnBase } from "./return-url.ts";

// Business refusals a page can explain (409). not_found is 404; anything else 400.
const CONFLICTS = new Set([
  "already_upgraded", "not_general_admission", "not_upgradable", "full", "preorder_sold_out",
  "closed", "event_not_live", "payments_unavailable",
]);

export type UpgradeStart =
  | { ok: true; reservation_number: string; type_name: string; party_size: number; amount_kes: number;
      authorizationUrl: string; accessCode: string; reference: string }
  | { ok: false; status: number; error: string; extra?: Record<string, unknown> };

export async function startTableUpgrade(db: any, req: Request, token: string, typeId: string): Promise<UpgradeStart> {
  // Capacity, platter stock, eligibility and pricing all happen inside the RPC,
  // under the event's capacity lock.
  const { data, error } = await db.rpc("start_reservation_upgrade", {
    p_token: token, p_reservation_type_id: typeId,
  });
  if (error) {
    console.error(JSON.stringify({ msg: "upgrade start failed", detail: error.message }));
    return { ok: false, status: 500, error: "upgrade_failed" };
  }
  const r: any = data;
  if (r?.result !== "created") {
    const code = r?.result ?? "upgrade_rejected";
    const status = code === "not_found" ? 404 : CONFLICTS.has(code) ? 409 : 400;
    const extra = code === "full" ? { remaining: r?.remaining } : code === "preorder_sold_out" ? { item: r?.item } : undefined;
    return { ok: false, status, error: code, extra };
  }

  const secret = Deno.env.get("PAYSTACK_SECRET_KEY")?.trim();
  const appUrl = Deno.env.get("APP_URL")?.trim()?.replace(/\/$/, "");
  const giveUp = async () => {
    await db.from("orders").update({ status: "failed" }).eq("id", r.order_id).eq("status", "pending");
    await db.from("reservation_upgrades").update({ status: "failed" }).eq("order_id", r.order_id);
  };
  if (!secret || !appUrl) {
    await giveUp();
    return { ok: false, status: 500, error: "paystack_misconfigured" };
  }

  const reference = `MT${crypto.randomUUID().replaceAll("-", "")}`;
  const { error: refErr } = await db.from("orders")
    .update({ paystack_reference: reference, payment_provider: "paystack" }).eq("id", r.order_id);
  if (refErr) {
    await giveUp();
    return { ok: false, status: 500, error: "order_correlation_failed" };
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
    return {
      ok: true, reservation_number: r.reservation_number, type_name: r.type_name,
      party_size: r.party_size, amount_kes: Number(r.amount_kes),
      authorizationUrl: response.data.authorization_url, accessCode: response.data.access_code, reference,
    };
  } catch (e) {
    await giveUp();
    console.error(JSON.stringify({ msg: "upgrade paystack init failed", detail: String(e).slice(0, 200) }));
    return { ok: false, status: 502, error: "paystack_init_failed" };
  }
}
