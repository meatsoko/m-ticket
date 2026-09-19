// FR-S4: scanner offline cache. Staff JWT required. Returns all tickets for a live event.
import { corsHeaders, json } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Verify caller JWT and staff role (verify_jwt=true still requires explicit check)
  const auth = req.headers.get("Authorization") ?? "";
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { global: { headers: { Authorization: auth } }, auth: { persistSession: false } }
  );
  const { data: userData } = await db.auth.getUser();
  if (!userData.user) return json({ error: "unauthorized" }, 401);
  const { data: role } = await db.from("admin_users").select("role").eq("user_id", userData.user.id).maybeSingle();
  if (!role) return json({ error: "forbidden" }, 403);

  const url = new URL(req.url);
  const eventId = url.searchParams.get("event_id");
  let q = db.from("tickets").select("qr_token,status,redeemed_at,orders!inner(event_id,events!inner(status))")
    .eq("orders.events.status", "live").eq("status", "active");
  if (eventId) q = q.eq("orders.event_id", eventId);

  const { data, error } = await q;
  if (error) return json({ error: error.message }, 500);
  return json({ tokens: (data ?? []).map((t: any) => ({ token: t.qr_token, status: t.status })) });
});
