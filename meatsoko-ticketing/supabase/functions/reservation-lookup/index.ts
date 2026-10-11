// "Find my reservation" by the phone used to reserve. Mirrors lookup/ for
// tickets: throttled, and returns only what the holder of that number needs.
import { json, preflight } from "../_shared/cors.ts";
import { clientIp, normalizePhone, rateLimit, serviceClient } from "../_shared/supabase.ts";

const PER_PHONE = { limit: 8, windowSeconds: 600 };
const PER_IP = { limit: 30, windowSeconds: 600 };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  const { phone, event_id } = await req.json().catch(() => ({}));
  const p = normalizePhone(String(phone ?? ""));
  if (!p) return json({ error: "invalid_phone" }, 400);

  const db = serviceClient();
  const byPhone = await rateLimit(db, `reslookup:phone:${p}`, PER_PHONE.limit, PER_PHONE.windowSeconds);
  if (!byPhone.allowed) return json({ error: "rate_limited", retry_after: byPhone.retryAfter }, 429);
  const byIp = await rateLimit(db, `reslookup:ip:${clientIp(req)}`, PER_IP.limit, PER_IP.windowSeconds);
  if (!byIp.allowed) return json({ error: "rate_limited", retry_after: byIp.retryAfter }, 429);

  let q = db.from("reservations")
    .select("reservation_number,access_token,party_size,status,expected_arrival,events(name)")
    .eq("phone", p).neq("status", "cancelled");
  if (event_id) q = q.eq("event_id", event_id);

  const { data } = await q;
  return json({
    reservations: (data ?? []).map((r: any) => ({
      reservation_number: r.reservation_number,
      token: r.access_token,
      party_size: r.party_size,
      status: r.status,
      expected_arrival: r.expected_arrival,
      event: r.events?.name ?? null,
    })),
  });
});
