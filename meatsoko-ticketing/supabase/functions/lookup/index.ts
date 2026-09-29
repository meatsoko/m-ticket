// FR-L1/L2: phone lookup for active, unredeemed tickets.
//
// The tickets are EMAILED to the address on the order, never returned here: a
// phone number is not a secret, and returning QR tokens to whoever typed one let a
// stranger take a buyer's tickets. The reply is a count and a masked address.
import { json, preflight } from "../_shared/cors.ts";
import { clientIp, normalizePhone, rateLimit, serviceClient } from "../_shared/supabase.ts";
import { sendTicketEmail } from "../_shared/email.ts";
import { maskEmail } from "../_shared/resend.ts";

// NFR-5 requires this endpoint be rate-limited: it maps a phone number to ticket tokens,
// so an unthrottled one lets anyone enumerate ticket holders.
const PER_PHONE = { limit: 8, windowSeconds: 600 };
const PER_IP = { limit: 30, windowSeconds: 600 };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  const { phone, event_id } = await req.json().catch(() => ({}));
  const p = normalizePhone(phone ?? "");
  if (!p) return json({ error: "invalid_phone" }, 400);

  const db = serviceClient();
  const byPhone = await rateLimit(db, `lookup:phone:${p}`, PER_PHONE.limit, PER_PHONE.windowSeconds);
  if (!byPhone.allowed) return json({ error: "rate_limited", retry_after: byPhone.retryAfter }, 429);
  const byIp = await rateLimit(db, `lookup:ip:${clientIp(req)}`, PER_IP.limit, PER_IP.windowSeconds);
  if (!byIp.allowed) return json({ error: "rate_limited", retry_after: byIp.retryAfter }, 429);

  let q = db.from("orders")
    .select("buyer_email,events(name,venue,starts_at),tickets(qr_token,status,ticket_types(name,bundle_qty))")
    .eq("buyer_phone", p).eq("status", "paid");
  if (event_id) q = q.eq("event_id", event_id);

  const { data: orders } = await q;
  const sentTo = new Set<string>();
  let found = 0, emailed = 0, noEmail = 0;
  for (const o of (orders ?? []) as any[]) {
    const active = (o.tickets ?? []).filter((t: any) => t.status === "active");
    if (!active.length) continue;
    found += active.length;
    if (!o.buyer_email) { noEmail += active.length; continue; }
    const out = await sendTicketEmail({
      to: o.buyer_email,
      eventName: o.events?.name ?? "Your event",
      venue: o.events?.venue ?? null,
      startsAt: o.events?.starts_at ?? null,
      tickets: active.map((t: any) => ({ token: t.qr_token, typeName: t.ticket_types?.name ?? "Ticket", bundleQty: t.ticket_types?.bundle_qty ?? 1 })),
    }).catch((e) => ({ sent: false, reason: String(e) }));
    if (out.sent) { emailed += active.length; sentTo.add(maskEmail(o.buyer_email)); }
    else console.error(JSON.stringify({ msg: "ticket lookup resend failed", reason: (out as any).reason }));
  }
  return json({ found, emailed, sent_to: [...sentTo], no_email: noEmail });
});
