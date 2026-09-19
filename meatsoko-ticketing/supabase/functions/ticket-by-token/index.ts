// Public ticket view by unguessable token (FR-T1): /t/<token> page data source.
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const { token } = await req.json().catch(() => ({}));
  if (!token || !/^[a-f0-9]{32}$/.test(token)) return json({ error: "not_found" }, 404);

  const db = serviceClient();
  const { data: t } = await db.from("tickets")
    .select("qr_token,status,redeemed_at,ticket_types(name,bundle_qty,events(name,venue,starts_at,status))")
    .eq("qr_token", token).maybeSingle();
  if (!t) return json({ error: "not_found" }, 404);

  const ev = t.ticket_types?.events;
  return json({
    token: t.qr_token,
    status: t.status,
    redeemed_at: t.redeemed_at,
    type: t.ticket_types?.name,
    bundle: t.ticket_types?.bundle_qty ?? 1,
    event: ev ? { name: ev.name, venue: ev.venue, starts_at: ev.starts_at, status: ev.status } : null,
  });
});
