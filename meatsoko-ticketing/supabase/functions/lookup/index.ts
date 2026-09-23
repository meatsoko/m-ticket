// FR-L1/L2: phone lookup — returns ONLY active, unredeemed tickets for a live event.
import { json, preflight } from "../_shared/cors.ts";
import { clientIp, normalizePhone, rateLimit, serviceClient } from "../_shared/supabase.ts";

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
    .select("event_id,tickets(qr_token,status,ticket_types(name,bundle_qty))")
    .eq("buyer_phone", p).eq("status", "paid");
  if (event_id) q = q.eq("event_id", event_id);

  const { data: orders } = await q;
  const tickets = (orders ?? []).flatMap((o: any) => o.tickets ?? [])
    .filter((t: any) => t.status === "active")
    .map((t: any) => ({ token: t.qr_token, type: t.ticket_types?.name, bundle: t.ticket_types?.bundle_qty }));
  return json({ tickets });
});
