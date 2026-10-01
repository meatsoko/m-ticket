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
    .select(`id,reservation_number,guest_name,party_size,expected_arrival,status,access_token,order_id,
             event_id,reservation_types(name,is_general_admission),
             orders(status,amount_kes),
             events(name,tagline,venue,starts_at,doors_open_at,status,contact_phone,payments_enabled,reservations_close_at)`)
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

  // General Admission: offer the table upgrades. Display only — the upgrade
  // itself is decided again, under a lock, by start_reservation_upgrade.
  const rtype: any = (data as any).reservation_types;
  let upgrade: any = null;
  if (rtype?.is_general_admission) {
    const reason = data.order_id ? "already_upgraded"
      : data.status !== "confirmed" ? "not_upgradable"
      : ev?.status !== "live" ? "event_not_live"
      : !ev?.payments_enabled ? "payments_unavailable"
      : ev?.reservations_close_at && Date.now() > new Date(ev.reservations_close_at).getTime() ? "closed"
      : null;
    const { data: types } = await db.from("reservation_types")
      .select("id,name,fixed_party_size,included_preorder_item_id,position")
      .eq("event_id", (data as any).event_id).eq("is_active", true).eq("is_general_admission", false)
      .not("included_preorder_item_id", "is", null).not("fixed_party_size", "is", null)
      .order("position");
    const ids = (types ?? []).map((t: any) => t.included_preorder_item_id);
    const { data: platters } = ids.length
      ? await db.from("preorder_items")
          .select("id,name,description,price_kes,compare_at_price_kes,early_bird_ends_at,image_url")
          .in("id", ids).eq("is_active", true)
      : { data: [] as any[] };
    const options = (types ?? []).flatMap((t: any) => {
      const p = (platters ?? []).find((x: any) => x.id === t.included_preorder_item_id);
      return p ? [{ id: t.id, name: t.name, party_size: t.fixed_party_size, platter: p }] : [];
    });
    upgrade = { available: !reason && options.length > 0, reason, options };
  }

  // Platter add-ons (migration 20261001120000): what's been paid for, and — for a
  // valid in-person booking — the family platters it can still add. Display
  // only; start_platter_addon re-checks everything under a lock.
  const { data: addonRows } = await db.from("reservation_addons")
    .select("orders(order_items(qty,unit_price_kes,preorder_items(name)))")
    .eq("reservation_id", (data as any).id).eq("status", "applied");
  const addons = ((addonRows ?? []) as any[]).flatMap((a) => (a.orders?.order_items ?? []).map((i: any) => ({
    name: i.preorder_items?.name ?? "Platter", qty: i.qty, unit_price_kes: i.unit_price_kes,
  })));
  let platter_addons: any = null;
  const addonOpen = data.status === "confirmed" && ev?.status === "live" && ev?.payments_enabled &&
    !(ev?.reservations_close_at && Date.now() > new Date(ev.reservations_close_at).getTime());
  if (addonOpen) {
    const { data: pkgs } = await db.from("reservation_types").select("included_preorder_item_id")
      .eq("event_id", (data as any).event_id).eq("is_active", true).not("included_preorder_item_id", "is", null);
    const ids = Array.from(new Set((pkgs ?? []).map((t: any) => t.included_preorder_item_id)));
    const { data: items } = ids.length
      ? await db.from("preorder_items").select("id,name,description,price_kes,compare_at_price_kes,early_bird_ends_at,image_url,max_per_reservation,position")
          .in("id", ids).eq("is_active", true).order("position")
      : { data: [] as any[] };
    platter_addons = { available: (items ?? []).length > 0, options: items ?? [] };
  }

  return json({
    reservation_number: data.reservation_number,
    addons,
    platter_addons,
    type_name: rtype?.name ?? null,
    general_admission: !!rtype?.is_general_admission,
    upgrade,
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
