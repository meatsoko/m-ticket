import { createClient } from "@/lib/supabase/server";
import TicketsHub, { type PaymentRow, type ActivityItem } from "@/components/dashboard/TicketsHub";
import type { TicketPass } from "@/components/dashboard/TicketsBoard";

export const dynamic = "force-dynamic";

// Every pass across events, as one list: bookings (free General Admission,
// tables, RSVPs — with their preorders) and paid tickets. Read with the admin's
// session: RLS "staff read" on reservations, orders, order_items and tickets.
export default async function TicketsPage() {
  const supabase = createClient();
  const [{ data: res, error: rErr }, { data: tix, error: tErr }, { data: events }, { data: pays }, { data: ups }, { data: scans }, { data: vendors }, { data: online }] = await Promise.all([
    supabase.from("reservations")
      .select(`id,event_id,order_id,reservation_number,access_token,guest_name,phone,email,party_size,status,created_at,checked_in_at,arrived_party_size,
               events(name,slug),reservation_types(name,is_general_admission),
               orders(status,amount_kes,paid_at,paystack_reference,order_items(qty,unit_price_kes,preorder_items(name))),
               reservation_addons(order_id,status,orders(order_items(qty,unit_price_kes,preorder_items(name))))`)
      .order("created_at", { ascending: false }).limit(2000),
    supabase.from("tickets")
      .select(`id,qr_token,status,redeemed_at,created_at,
               ticket_types(name,bundle_qty,event_id,events(name,slug)),
               orders(buyer_phone,buyer_email,amount_kes,status,paid_at,paystack_reference)`)
      .order("created_at", { ascending: false }).limit(2000),
    supabase.from("events").select("id,name,starts_at").order("starts_at", { ascending: false }),
    supabase.from("orders").select("id,event_id,status,amount_kes,created_at,paid_at,refunded_at,refund_reason,reversal_ref,paystack_reference,buyer_phone,buyer_email,events(name)")
      .in("status", ["paid", "flagged", "refunded"]).order("created_at", { ascending: false }).limit(2000),
    supabase.from("reservation_upgrades").select("order_id,reservation_id,status,created_at,applied_at,reservation_types(name)").limit(4000),
    supabase.from("redemptions").select("scanned_at,station,reservation_id,ticket_id").order("scanned_at", { ascending: false }).limit(1000),
    supabase.from("vendor_applications").select("event_id,reference_number,name,vendor_type,status,amount_kes,created_at,paid_at,events(name)").limit(2000),
    supabase.from("online_registrations").select("id,event_id,registration_number,name,email,country,access_code,status,created_at,revoked_at,last_access_at,access_count,events(name,slug)")
      .order("created_at", { ascending: false }).limit(4000),
  ]);
  if (rErr || tErr) return <p className="dash-error">Couldn&apos;t load tickets: {(rErr ?? tErr)!.message}</p>;

  const passes: TicketPass[] = [
    ...((res ?? []) as any[]).map((r): TicketPass => {
      const o = r.orders;
      const items = (o?.order_items ?? []).map((i: any) => ({ name: i.preorder_items?.name ?? "Item", qty: i.qty, unitKes: Number(i.unit_price_kes) }));
      // Paid platter add-ons (migration 20261001120000) are preorders too.
      const addonItems = ((r.reservation_addons ?? []) as any[]).filter((a) => a.status === "applied")
        .flatMap((a) => (a.orders?.order_items ?? []).map((i: any) => ({ name: i.preorder_items?.name ?? "Platter", qty: i.qty, unitKes: Number(i.unit_price_kes), addon: true })));
      const type = r.reservation_types?.name ?? "Reservation";
      return {
        id: r.id, source: "booking", eventId: r.event_id, eventName: r.events?.name ?? "—", eventSlug: r.events?.slug ?? "",
        number: r.reservation_number, token: r.access_token, passPath: `/r/${r.access_token}`,
        holder: r.guest_name, phone: r.phone, email: r.email,
        type, kind: r.reservation_types?.is_general_admission ? "ga" : items.length ? "table" : "rsvp",
        people: r.party_size, arrived: r.arrived_party_size,
        status: r.status, createdAt: r.created_at, checkedInAt: r.checked_in_at,
        preorders: [...items, ...addonItems], addons: addonItems.length,
        payment: o ? { status: o.status, amountKes: Number(o.amount_kes), paidAt: o.paid_at, reference: o.paystack_reference } : null,
      };
    }),
    ...((tix ?? []) as any[]).map((t): TicketPass => {
      const tt = t.ticket_types, o = t.orders;
      return {
        id: t.id, source: "ticket", eventId: tt?.event_id ?? "", eventName: tt?.events?.name ?? "—", eventSlug: tt?.events?.slug ?? "",
        number: `TKT-${String(t.id).slice(0, 6).toUpperCase()}`, token: t.qr_token, passPath: `/t/${t.qr_token}`,
        holder: o?.buyer_email ?? "Ticket holder", phone: o?.buyer_phone ?? "", email: o?.buyer_email ?? null,
        type: tt?.name ?? "Ticket", kind: "paid", people: tt?.bundle_qty ?? 1, arrived: null,
        status: t.status === "redeemed" ? "checked_in" : t.status === "refunded" ? "cancelled" : "confirmed",
        createdAt: t.created_at, checkedInAt: t.redeemed_at, preorders: [],
        payment: o ? { status: o.status, amountKes: Number(o.amount_kes), paidAt: o.paid_at, reference: o.paystack_reference } : null,
      };
    }),
    // Online attendance (migration 20261001100000): no phone, no QR, no capacity.
    ...((online ?? []) as any[]).map((o): TicketPass => ({
      id: o.id, source: "online", eventId: o.event_id, eventName: o.events?.name ?? "—", eventSlug: o.events?.slug ?? "",
      number: o.registration_number, token: o.access_code, passPath: `/watch/${o.access_code}`,
      holder: o.name, phone: "", email: o.email, country: o.country,
      type: "Online attendance", kind: "online", people: 1, arrived: null,
      status: o.status === "revoked" ? "revoked" : "confirmed", createdAt: o.created_at, checkedInAt: null,
      preorders: [], payment: null, lastAccessAt: o.last_access_at, accessCount: o.access_count,
    })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // Payments: each paid/flagged/refunded event order, tied to its booking — a
  // table booking (reservations.order_id) or a table upgrade (reservation_upgrades).
  const byId = new Map(passes.filter((p) => p.source === "booking").map((p) => [p.id, p]));
  const byOrder = new Map<string, TicketPass>();
  for (const r of (res ?? []) as any[]) if (r.orders && (r as any).order_id) byOrder.set((r as any).order_id, byId.get(r.id)!);
  const upByOrder = new Map(((ups ?? []) as any[]).map((u) => [u.order_id, u]));
  const addonByOrder = new Map<string, string>();   // add-on order id -> reservation id
  for (const r of (res ?? []) as any[]) for (const a of (r.reservation_addons ?? [])) addonByOrder.set(a.order_id, r.id);
  const payments: PaymentRow[] = ((pays ?? []) as any[]).map((o) => {
    const up = upByOrder.get(o.id);
    const addonRes = addonByOrder.get(o.id);
    const pass = byOrder.get(o.id) ?? (up ? byId.get(up.reservation_id) : addonRes ? byId.get(addonRes) : undefined);
    return {
      id: o.id, eventId: o.event_id, eventName: o.events?.name ?? "—", status: o.status, amountKes: Number(o.amount_kes),
      createdAt: o.created_at, paidAt: o.paid_at, refundedAt: o.refunded_at, refundReason: o.refund_reason, reversalRef: o.reversal_ref,
      reference: o.paystack_reference, phone: o.buyer_phone, email: o.buyer_email,
      what: up ? `Table upgrade · ${up.reservation_types?.name ?? "table"}` : addonRes ? "Platter add-on" : pass ? pass.type : "Ticket order",
      isUpgrade: !!up && up.status === "applied", upgradeStatus: up?.status ?? null,
      pass: pass ? { number: pass.number, holder: pass.holder, status: pass.status, id: pass.id } : null,
    };
  });

  // Activity: what happened on the ticketing platform, newest first.
  const passById = new Map(passes.map((p) => [p.id, p]));
  const activity: ActivityItem[] = [
    ...passes.filter((p) => p.source === "booking").map((p): ActivityItem => ({ at: p.createdAt, kind: "booked", eventId: p.eventId, eventName: p.eventName,
      title: `${p.holder} booked ${p.type}`, detail: `${p.number} · ${p.people} ${p.people === 1 ? "person" : "people"}` })),
    ...passes.filter((p) => p.source === "ticket").map((p): ActivityItem => ({ at: p.createdAt, kind: "booked", eventId: p.eventId, eventName: p.eventName,
      title: `${p.type} ticket issued`, detail: p.number })),
    ...payments.filter((p) => p.paidAt).map((p): ActivityItem => ({ at: p.paidAt!, kind: p.status === "flagged" ? "flagged" : "paid", eventId: p.eventId, eventName: p.eventName,
      title: p.status === "flagged" ? `Payment needs a look — KSh ${Math.round(p.amountKes).toLocaleString("en-KE")}` : `Paid KSh ${Math.round(p.amountKes).toLocaleString("en-KE")} · ${p.what}`,
      detail: [p.pass ? `${p.pass.number} · ${p.pass.holder}` : null, p.reference].filter(Boolean).join(" · ") })),
    ...((ups ?? []) as any[]).filter((u) => u.applied_at).map((u): ActivityItem => {
      const p = passById.get(u.reservation_id);
      return { at: u.applied_at, kind: "upgraded", eventId: p?.eventId ?? "", eventName: p?.eventName ?? "—",
        title: `${p?.holder ?? "A guest"} upgraded to ${u.reservation_types?.name ?? "a table"}`, detail: p?.number ?? "" };
    }),
    ...((scans ?? []) as any[]).map((s): ActivityItem => {
      const p = passById.get(s.reservation_id ?? s.ticket_id);
      return { at: s.scanned_at, kind: "checked_in", eventId: p?.eventId ?? "", eventName: p?.eventName ?? "—",
        title: `${p?.holder ?? "A guest"} checked in`, detail: [p?.number, s.station && `at ${s.station}`].filter(Boolean).join(" · ") };
    }),
    ...payments.filter((p) => p.refundedAt).map((p): ActivityItem => ({ at: p.refundedAt!, kind: "refunded", eventId: p.eventId, eventName: p.eventName,
      title: `Refunded KSh ${Math.round(p.amountKes).toLocaleString("en-KE")}${p.pass ? ` to ${p.pass.holder}` : ""}`, detail: p.refundReason ?? "" })),
    ...((online ?? []) as any[]).map((o): ActivityItem => ({ at: o.created_at, kind: "online", eventId: o.event_id, eventName: o.events?.name ?? "—",
      title: `${o.name} registered to watch online`, detail: `${o.registration_number} · ${o.country}${o.status === "revoked" ? " · access revoked" : ""}` })),
    ...((vendors ?? []) as any[]).flatMap((v): ActivityItem[] => [
      { at: v.created_at, kind: "vendor", eventId: v.event_id, eventName: v.events?.name ?? "—",
        title: `${v.name} registered as a vendor`, detail: `${v.reference_number} · ${v.vendor_type}${v.status === "pending_payment" ? " · payment pending" : ""}` },
      ...(v.paid_at ? [{ at: v.paid_at, kind: "paid" as const, eventId: v.event_id, eventName: v.events?.name ?? "—",
        title: `Vendor tent paid KSh ${Math.round(Number(v.amount_kes)).toLocaleString("en-KE")} · ${v.name}`, detail: v.reference_number }] : []),
    ]),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return <TicketsHub passes={passes} payments={payments} activity={activity}
    events={(events ?? []).map((e: any) => ({ id: e.id, name: e.name }))} />;
}
