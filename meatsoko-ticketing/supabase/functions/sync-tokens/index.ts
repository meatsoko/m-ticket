// FR-S4: scanner offline cache. Staff JWT required.
// Returns every non-refunded ticket for the live event WITH its redemption state, so an
// offline device can tell "already redeemed at 14:32" apart from "not a real ticket".
import { json, preflight } from "../_shared/cors.ts";
import { requireStaff } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();

  const auth = await requireStaff(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const { db } = auth;

  const eventId = new URL(req.url).searchParams.get("event_id");
  let q = db
    .from("tickets")
    .select("qr_token,status,redeemed_at,orders!inner(event_id,events!inner(status))")
    .eq("orders.events.status", "live")
    .neq("status", "refunded");
  if (eventId) q = q.eq("orders.event_id", eventId);

  const { data, error } = await q;
  if (error) return json({ error: error.message }, 500);

  return json({
    synced_at: new Date().toISOString(),
    tokens: (data ?? []).map((t: any) => ({
      token: t.qr_token,
      status: t.status,
      redeemed_at: t.redeemed_at,
    })),
  });
});
