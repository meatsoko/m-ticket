// FR-S4: scanner offline cache. Staff JWT required.
//
// Returns every admissible pass for the live event — tickets AND reservations —
// with its current redemption state, so an offline device can tell "already
// admitted at 14:32" apart from "not a real pass". The shape is identical for
// both kinds, which is what lets the IndexedDB cache stay unchanged.
import { json, preflight } from "../_shared/cors.ts";
import { requireStaff } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();

  const auth = await requireStaff(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const { db } = auth;

  const eventId = new URL(req.url).searchParams.get("event_id");

  let tq = db.from("tickets")
    .select("qr_token,status,redeemed_at,orders!inner(event_id,events!inner(status))")
    .eq("orders.events.status", "live")
    .neq("status", "refunded");
  if (eventId) tq = tq.eq("orders.event_id", eventId);

  let rq = db.from("reservations")
    .select("access_token,status,checked_in_at,guest_name,party_size,order_id,events!inner(status),orders(status)")
    .eq("events.status", "live")
    .neq("status", "cancelled");
  if (eventId) rq = rq.eq("event_id", eventId);

  const [{ data: tickets, error: tErr }, { data: reservations, error: rErr }] =
    await Promise.all([tq, rq]);
  if (tErr) return json({ error: tErr.message }, 500);
  if (rErr) return json({ error: rErr.message }, 500);

  const tokens = [
    ...(tickets ?? []).map((t: any) => ({
      token: t.qr_token,
      kind: "ticket",
      status: t.status === "redeemed" ? "redeemed" : "active",
      redeemed_at: t.redeemed_at,
      holder_name: null,
      party_size: 1,
      paid: true,
    })),
    ...(reservations ?? []).map((r: any) => ({
      token: r.access_token,
      kind: "reservation",
      status: r.status === "checked_in" ? "redeemed" : "active",
      redeemed_at: r.checked_in_at,
      holder_name: r.guest_name,
      party_size: r.party_size,
      // An unpaid preorder is cached as not-admissible so the offline gate
      // rejects it the same way the server would.
      paid: r.order_id === null ? true : r.orders?.status === "paid",
    })),
  ];

  return json({ synced_at: new Date().toISOString(), tokens });
});
