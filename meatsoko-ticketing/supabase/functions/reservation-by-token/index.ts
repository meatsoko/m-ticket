// Public pass view for /r/<access_token>. Unguessable token only — the short
// reservation number is never accepted here, because it is enumerable.
import { json, preflight } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  const { token } = await req.json().catch(() => ({}));
  if (!token || !/^[a-f0-9]{32}$/.test(token)) return json({ error: "not_found" }, 404);

  const db = serviceClient();
  const { data } = await db.from("reservations")
    .select(`reservation_number,guest_name,party_size,expected_arrival,status,access_token,order_id,
             orders(status,amount_kes),
             events(name,tagline,venue,starts_at,doors_open_at,status,contact_phone)`)
    .eq("access_token", token).maybeSingle();
  if (!data) return json({ error: "not_found" }, 404);

  const ev: any = (data as any).events;
  const order: any = (data as any).orders;
  let preorder: any[] = [];
  if (data.order_id) {
    const { data: items } = await db.from("order_items")
      .select("qty,unit_price_kes,preorder_items(name)")
      .eq("order_id", data.order_id).not("preorder_item_id", "is", null);
    preorder = (items ?? []).map((i: any) => ({
      name: i.preorder_items?.name ?? "Item", qty: i.qty, unit_price_kes: i.unit_price_kes,
    }));
  }

  return json({
    reservation_number: data.reservation_number,
    guest_name: data.guest_name,
    party_size: data.party_size,
    expected_arrival: data.expected_arrival,
    status: data.status,
    token: data.access_token,
    payment_status: data.order_id ? (order?.status ?? "unknown") : "not_required",
    amount_kes: order?.amount_kes ?? 0,
    preorder,
    event: ev ? {
      name: ev.name, tagline: ev.tagline, venue: ev.venue,
      starts_at: ev.starts_at, doors_open_at: ev.doors_open_at,
      status: ev.status, contact_phone: ev.contact_phone,
    } : null,
  });
});
