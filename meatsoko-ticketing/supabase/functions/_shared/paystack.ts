import { serviceClient } from "./supabase.ts";
import { sendTicketEmail } from "./email.ts";
import { buildAndSend } from "./reservation-email.ts";

export async function verifyAndConfirm(reference: string) {
  if (!/^[A-Za-z0-9.=_-]{6,100}$/.test(reference)) throw new Error("invalid_reference");
  const db = serviceClient();
  const { data: order, error } = await db.from("orders")
    .select("id,status,amount_kes,buyer_email,channel,paystack_reference,events(name,venue,starts_at)")
    .eq("paystack_reference", reference).maybeSingle();
  if (error || !order) throw new Error("unknown_reference");
  if (order.status === "paid") return { result: "already", order_id: order.id };
  if (order.status !== "pending") return { result: "ignored", status: order.status };

  const secret = Deno.env.get("PAYSTACK_SECRET_KEY")?.trim();
  if (!secret) throw new Error("paystack_misconfigured");
  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const verified: any = await response.json().catch(() => null);
  const transaction = verified?.data;
  if (!response.ok || verified?.status !== true) throw new Error("paystack_verification_unavailable");
  if (transaction?.status !== "success") return { result: "not_paid", status: transaction?.status ?? "unverified" };
  if (transaction.reference !== reference || transaction.currency !== "KES" ||
      Number(transaction.amount) !== Math.round(Number(order.amount_kes) * 100)) {
    await db.from("orders").update({ status: "flagged" }).eq("id", order.id).eq("status", "pending");
    return { result: "mismatch" };
  }

  const { data, error: confirmError } = await db.rpc("confirm_paystack_payment", {
    p_reference: reference, p_amount_kes: Number(transaction.amount) / 100,
  });
  if (confirmError) throw new Error(`confirmation_failed:${confirmError.message}`);
  const result: any = data;
  if (result?.result === "confirmed") {
    if (result.kind === "reservation") {
      const appUrl = (Deno.env.get("APP_URL") ?? "").trim();
      if (appUrl) await buildAndSend(db, result.reservation_id, appUrl)
        .catch((e) => console.error("reservation email failed", reference, e));
    } else if (order.buyer_email && order.channel !== "gate") {
      const { data: tickets } = await db.from("tickets")
        .select("qr_token,ticket_types(name,bundle_qty)").eq("order_id", order.id);
      const event: any = (order as any).events;
      if (tickets?.length) await sendTicketEmail({
        to: order.buyer_email,
        eventName: event?.name ?? "Your event",
        venue: event?.venue ?? null,
        startsAt: event?.starts_at ?? null,
        tickets: tickets.map((t: any) => ({
          token: t.qr_token, typeName: t.ticket_types?.name ?? "Ticket",
          bundleQty: t.ticket_types?.bundle_qty ?? 1,
        })),
      }).catch((e) => console.error("ticket email failed", reference, e));
    }
  }
  return result;
}
