// FR-L1/L2: phone lookup — returns ONLY active, unredeemed tickets for a live event.
import { corsHeaders, json } from "../_shared/cors.ts";
import { normalizePhone, serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const { phone, event_id } = await req.json().catch(() => ({}));
  const p = normalizePhone(phone ?? "");
  if (!p) return json({ error: "invalid_phone" }, 400);

  const db = serviceClient();
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
