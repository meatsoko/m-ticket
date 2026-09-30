import { createClient } from "@/lib/supabase/server";
import TicketsBoard, { type TicketPass } from "@/components/dashboard/TicketsBoard";

export const dynamic = "force-dynamic";

// Every pass across events, as one list: bookings (free General Admission,
// tables, RSVPs — with their preorders) and paid tickets. Read with the admin's
// session: RLS "staff read" on reservations, orders, order_items and tickets.
export default async function TicketsPage() {
  const supabase = createClient();
  const [{ data: res, error: rErr }, { data: tix, error: tErr }, { data: events }] = await Promise.all([
    supabase.from("reservations")
      .select(`id,event_id,reservation_number,access_token,guest_name,phone,email,party_size,status,created_at,checked_in_at,arrived_party_size,
               events(name,slug),reservation_types(name,is_general_admission),
               orders(status,amount_kes,paid_at,paystack_reference,order_items(qty,unit_price_kes,preorder_items(name)))`)
      .order("created_at", { ascending: false }).limit(2000),
    supabase.from("tickets")
      .select(`id,qr_token,status,redeemed_at,created_at,
               ticket_types(name,bundle_qty,event_id,events(name,slug)),
               orders(buyer_phone,buyer_email,amount_kes,status,paid_at,paystack_reference)`)
      .order("created_at", { ascending: false }).limit(2000),
    supabase.from("events").select("id,name,starts_at").order("starts_at", { ascending: false }),
  ]);
  if (rErr || tErr) return <p className="dash-error">Couldn&apos;t load tickets: {(rErr ?? tErr)!.message}</p>;

  const passes: TicketPass[] = [
    ...((res ?? []) as any[]).map((r): TicketPass => {
      const o = r.orders;
      const items = (o?.order_items ?? []).map((i: any) => ({ name: i.preorder_items?.name ?? "Item", qty: i.qty, unitKes: Number(i.unit_price_kes) }));
      const type = r.reservation_types?.name ?? "Reservation";
      return {
        id: r.id, source: "booking", eventId: r.event_id, eventName: r.events?.name ?? "—", eventSlug: r.events?.slug ?? "",
        number: r.reservation_number, token: r.access_token, passPath: `/r/${r.access_token}`,
        holder: r.guest_name, phone: r.phone, email: r.email,
        type, kind: r.reservation_types?.is_general_admission ? "ga" : items.length ? "table" : "rsvp",
        people: r.party_size, arrived: r.arrived_party_size,
        status: r.status, createdAt: r.created_at, checkedInAt: r.checked_in_at,
        preorders: items, payment: o ? { status: o.status, amountKes: Number(o.amount_kes), paidAt: o.paid_at, reference: o.paystack_reference } : null,
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
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return <TicketsBoard passes={passes} events={(events ?? []).map((e: any) => ({ id: e.id, name: e.name }))} />;
}
