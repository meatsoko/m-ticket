import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EventBookings, { type BookingRow } from "@/components/dashboard/EventBookings";
import EventSettings from "@/components/EventSettings";
import EventStatusControls from "@/components/EventStatusControls";
import ReservationTypesPanel from "@/components/ReservationTypesPanel";
import PreorderItemsPanel from "@/components/PreorderItemsPanel";
import EventDashboard from "@/components/EventDashboard";
import type { PreorderItem, ReservationType } from "@/lib/types";

export const dynamic = "force-dynamic";

const fmt = (iso: string) => new Intl.DateTimeFormat("en-KE", { timeZone: "Africa/Nairobi", weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const kes = (n: number) => `KSh ${Math.round(n).toLocaleString("en-KE")}`;
const STATUS: Record<string, string> = { live: "Live", draft: "Draft", closed: "Closed" };

export default async function DashboardEventPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: ev } = await supabase.from("events").select("*").eq("id", params.id).maybeSingle();
  if (!ev) notFound();
  const isReservation = (ev.reservation_mode ?? "off") !== "off";

  const header = (
    <div className="dash-title-row">
      <div className="dash-title">
        <Link href="/dashboard/events" className="dash-link">← All events</Link>
        <h1>{ev.name} <span className={`dash-badge ev-${ev.status}`}>{STATUS[ev.status] ?? ev.status}</span></h1>
        <p>{fmt(ev.starts_at)}{ev.venue ? ` · ${ev.venue}` : ""}</p>
      </div>
      <div className="dash-toolbar-right">
        {ev.status === "live" && <a className="dash-btn" href={`/e/${ev.slug}`} target="_blank" rel="noopener noreferrer">View public page ↗</a>}
      </div>
    </div>
  );

  // Ticketed (non-reservation) events keep their existing admin tools.
  if (!isReservation) {
    const { data: types } = await supabase.from("ticket_types").select("*").eq("event_id", ev.id).order("position");
    const { data: orders } = await supabase.from("orders").select("id,status,channel,amount_kes,buyer_phone,created_at").eq("event_id", ev.id);
    const { data: tickets } = await supabase.from("tickets").select("id,status,qr_token,order_id,ticket_type_id,redeemed_at")
      .in("order_id", (orders ?? []).map((o: any) => o.id).concat(["00000000-0000-0000-0000-000000000000"]));
    return (
      <div className="dash-stack">
        {header}
        <div className="dash-legacy dash-settings-grid">
          <div className="dash-card"><EventSettings event={ev} /></div>
          <div className="dash-card"><EventDashboard event={ev} types={types ?? []} orders={orders ?? []} tickets={tickets ?? []} /></div>
        </div>
      </div>
    );
  }

  const [{ data: rows }, { data: stats }, { data: items }, { data: resTypes }] = await Promise.all([
    supabase.from("reservations").select("*,orders(status,amount_kes),reservation_types(name)")
      .eq("event_id", ev.id).order("created_at", { ascending: false }),
    supabase.rpc("expected_attendance", { p_event_id: ev.id }),
    supabase.from("preorder_items").select("*").eq("event_id", ev.id).order("position"),
    supabase.from("reservation_types").select("*").eq("event_id", ev.id).order("position"),
  ]);
  const list = (rows ?? []) as BookingRow[];
  const live = list.filter((r) => r.status !== "cancelled");
  const paid = list.filter((r) => r.orders?.status === "paid").reduce((s, r) => s + Number(r.orders?.amount_kes ?? 0), 0);
  const inside = list.filter((r) => r.status === "checked_in").reduce((s, r) => s + Number(r.arrived_party_size ?? r.party_size), 0);
  const a: any = stats ?? {};
  const expected = Number(a.expected_attendance ?? 0);
  const byType = new Map<string, { bookings: number; people: number }>();
  for (const r of live) {
    const k = r.reservation_types?.name ?? "Other";
    const x = byType.get(k) ?? { bookings: 0, people: 0 };
    x.bookings += 1; x.people += r.party_size; byType.set(k, x);
  }
  const typeRows = Array.from(byType.entries()).sort((x, y) => y[1].people - x[1].people);
  const maxPeople = Math.max(1, ...typeRows.map(([, v]) => v.people));

  return (
    <div className="dash-stack">
      {header}
      <div className="dash-kpis">
        <div className="dash-kpi"><span className="dash-kpi-label">Expected guests</span>
          <div className="dash-kpi-row"><strong>{expected}</strong>{ev.capacity ? <span className="dash-delta">{Math.round((expected / ev.capacity) * 100)}% of {ev.capacity}</span> : null}</div>
          <small>{ev.capacity ? `${Math.max(0, ev.capacity - expected)} places left` : "no capacity set"}</small></div>
        <div className="dash-kpi"><span className="dash-kpi-label">Bookings</span><div className="dash-kpi-row"><strong>{live.length}</strong></div><small>{list.length - live.length} cancelled</small></div>
        <div className="dash-kpi"><span className="dash-kpi-label">Checked in</span><div className="dash-kpi-row"><strong>{inside}</strong></div><small>people through the gate</small></div>
        <div className="dash-kpi"><span className="dash-kpi-label">Paid for tables</span><div className="dash-kpi-row"><strong>{kes(paid)}</strong></div><small>confirmed Paystack payments</small></div>
      </div>

      {typeRows.length > 0 && (
        <div className="dash-card">
          <h2>Tickets by type</h2>
          <ul className="dash-types dash-types-wide">
            {typeRows.map(([name, v]) => (
              <li key={name}><div><span>{name}</span><span>{v.bookings} bookings · {v.people} people</span></div><i style={{ width: `${(v.people / maxPeople) * 100}%` }} /></li>
            ))}
          </ul>
        </div>
      )}

      <EventBookings eventSlug={ev.slug} rows={list} />

      <div className="dash-title"><h2 className="dash-section-title">Settings</h2><p>Event details, ticket and table packages, platters. Changes apply to the public page straight away.</p></div>
      <div className="dash-legacy dash-settings-grid">
        <div className="dash-card"><EventSettings event={ev} /><EventStatusControls eventId={ev.id} status={ev.status} /></div>
        <div className="dash-stack">
          <div className="dash-card"><ReservationTypesPanel eventId={ev.id} types={(resTypes ?? []) as ReservationType[]} items={(items ?? []) as PreorderItem[]} /></div>
          {ev.reservation_mode !== "free" && <div className="dash-card"><PreorderItemsPanel eventId={ev.id} items={(items ?? []) as PreorderItem[]} /></div>}
        </div>
      </div>
    </div>
  );
}
