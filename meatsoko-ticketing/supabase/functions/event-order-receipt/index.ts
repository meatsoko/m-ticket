// Public receipt for /receipt/<receipt_token> (Event Orders, migration
// 20261003100000). The 32-hex token only — the short order number is
// sequential and is never accepted here. The phone comes back masked and staff
// are not named (get_event_order_receipt).
import { json, preflight } from "../_shared/cors.ts";
import { clientIp, rateLimit, serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const { token } = await req.json().catch(() => ({}));
  if (typeof token !== "string" || !/^[a-f0-9]{32}$/.test(token)) return json({ error: "not_found" }, 404);

  const db = serviceClient();
  const limit = await rateLimit(db, `receipt:ip:${clientIp(req)}`, 60, 600);
  if (!limit.allowed) return json({ error: "rate_limited", retry_after: limit.retryAfter }, 429);

  const { data, error } = await db.rpc("get_event_order_receipt", { p_token: token });
  if (error) { console.error(JSON.stringify({ msg: "receipt lookup failed", detail: error.message })); return json({ error: "lookup_failed" }, 500); }
  if (!data) return json({ error: "not_found" }, 404);
  return json(data);
});
