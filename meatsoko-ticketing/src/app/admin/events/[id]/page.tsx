import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EventDashboard from "@/components/EventDashboard";
import EventSettings from "@/components/EventSettings";
import EventStatusControls from "@/components/EventStatusControls";
import ReservationsPanel from "@/components/ReservationsPanel";
import PreorderItemsPanel from "@/components/PreorderItemsPanel";
import ReservationTypesPanel from "@/components/ReservationTypesPanel";
import type { PreorderItem, ReservationType } from "@/lib/types";

const MODE_LABEL: Record<string, string> = {
  free: "Free RSVP",
  optional_preorder: "RSVP + optional preorder",
  required_preorder: "RSVP + required preorder",
};

export default async function AdminEventPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: ev } = await supabase.from("events").select("*").eq("id", params.id).maybeSingle();
  if (!ev) notFound();

  // Settings render for EVERY event regardless of mode — that control is what
  // switches a ticketed event to reservations and back. Without it the
  // reservation feature has no way to be turned on.
  const isReservation = (ev.reservation_mode ?? "off") !== "off";

  if (isReservation) {
    const [{ data: rows }, { data: stats }, { data: items }, { data: resTypes }] = await Promise.all([
      supabase.from("reservations")
        .select("*,orders(status,amount_kes)")
        .eq("event_id", ev.id).order("created_at", { ascending: false }),
      supabase.rpc("expected_attendance", { p_event_id: ev.id }),
      supabase.from("preorder_items").select("*").eq("event_id", ev.id).order("position"),
      supabase.from("reservation_types").select("*").eq("event_id", ev.id).order("position"),
    ]);

    return (
      <div className="stack">
        <div className="row">
          <h1>{ev.name}</h1>
          <span className={`pill ${ev.status === "live" ? "ok" : ""}`}>{ev.status}</span>
        </div>
        <span className="pill ember">{MODE_LABEL[ev.reservation_mode] ?? ev.reservation_mode}</span>

        <EventSettings event={ev} />
        <EventStatusControls eventId={ev.id} status={ev.status} />
        <ReservationsPanel eventId={ev.id} reservations={rows ?? []} stats={stats} />
        <ReservationTypesPanel eventId={ev.id} types={(resTypes ?? []) as ReservationType[]} />
        {ev.reservation_mode !== "free" && (
          <PreorderItemsPanel eventId={ev.id} items={(items ?? []) as PreorderItem[]} />
        )}
      </div>
    );
  }

  const { data: types } = await supabase.from("ticket_types").select("*")
    .eq("event_id", ev.id).order("position");

  const { data: orders } = await supabase.from("orders")
    .select("id,status,channel,amount_kes,buyer_phone,created_at")
    .eq("event_id", ev.id);

  const { data: tickets } = await supabase.from("tickets")
    .select("id,status,qr_token,order_id,ticket_type_id,redeemed_at")
    .in("order_id", (orders ?? []).map((o: any) => o.id).concat(["00000000-0000-0000-0000-000000000000"]));

  return (
    <div className="stack">
      <EventSettings event={ev} />
      <EventDashboard
        event={ev}
        types={types ?? []}
        orders={orders ?? []}
        tickets={tickets ?? []}
      />
    </div>
  );
}
