// Poll a reservation after a preorder STK push. Mirrors order-status.
//
// Keyed on access_token (128-bit, unguessable) rather than the checkout id,
// because the checkout id is derivable from a phone number and a timestamp.
import { json, preflight } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  const { access_token } = await req.json().catch(() => ({}));
  if (!access_token || !/^[a-f0-9]{32}$/.test(access_token)) return json({ error: "not_found" }, 404);

  const db = serviceClient();
  const { data } = await db.from("reservations")
    .select("reservation_number,status,party_size,order_id,orders(status,amount_kes)")
    .eq("access_token", access_token).maybeSingle();
  if (!data) return json({ error: "not_found" }, 404);

  const order: any = (data as any).orders;
  return json({
    reservation_number: data.reservation_number,
    status: data.status,
    party_size: data.party_size,
    // Payment truth is read through the order, never duplicated on the row.
    payment_status: data.order_id ? (order?.status ?? "unknown") : "not_required",
    amount_kes: order?.amount_kes ?? 0,
  });
});
