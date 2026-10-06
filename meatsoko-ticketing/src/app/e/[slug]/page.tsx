import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/AppShell";
import EventCheckout from "@/components/EventCheckout";
import ReservationForm from "@/components/ReservationForm";
import GetTicketsPanel from "@/components/GetTicketsPanel";
import type { UpgradeOption } from "@/components/TableUpgrade";
import { nairobiTimeRange } from "@/lib/event-time";
import type { Event, TicketType, PreorderItem, ReservationType } from "@/lib/types";

/** Nairobi, always — the buyer and the venue are both there. */
const KE = "Africa/Nairobi";
const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-KE", { timeZone: KE, ...opts }).format(new Date(iso));

export default async function EventPage({ params }: { params: { slug: string } }) {
  const supabase = createClient();
  const { data: ev } = await supabase.from("events").select("*")
    .eq("slug", params.slug).eq("status", "live").maybeSingle();
  if (!ev) notFound();

  // How an event sells is configuration: a ticketed event renders the checkout,
  // a reservation event renders the RSVP form. Same page, same shell.
  const reservationMode = ev.reservation_mode ?? "off";
  const isReservation = reservationMode !== "off";
  // Announced but not open yet ("Coming soon" on /events): nothing to book and
  // no vendor sign-up until reservations_open_at. create_reservation and
  // vendor-apply refuse it server-side too.
  const notOpenYet = !!ev.reservations_open_at && new Date(ev.reservations_open_at).getTime() > Date.now();

  const { data: types } = isReservation ? { data: [] } : await supabase.from("ticket_types").select("*")
    .eq("event_id", ev.id).eq("is_active", true).order("position");

  const { data: preorderItems } = isReservation
    ? await supabase.from("preorder_items").select("*")
        .eq("event_id", ev.id).eq("is_active", true).order("position")
    : { data: [] };

  const { data: reservationTypes } = isReservation
    ? await supabase.from("reservation_types").select("*")
        .eq("event_id", ev.id).eq("is_active", true).order("position")
    : { data: [] };

  const linkedTypes = (reservationTypes ?? []).map((type: any) => ({
    ...type,
    included_preorder_item: (preorderItems ?? []).find(
      (item: any) => item.id === type.included_preorder_item_id
    ) ?? null,
  })).filter((type: any) => !type.included_preorder_item_id || type.included_preorder_item);
  const hasConfiguredPackages = linkedTypes.some((type: any) => !!type.included_preorder_item_id);
  // General Admission first (migration 20260929180000): when the event has a GA
  // type, the page issues the free ticket and the table packages become
  // upgrades of it. Events without one keep the original reservation form.
  const gaType = (reservationTypes ?? []).find((type: any) => type.is_general_admission);
  const upgradeOptions: UpgradeOption[] = linkedTypes
    .filter((type: any) => !type.is_general_admission && type.included_preorder_item && type.fixed_party_size)
    .map((type: any) => ({ id: type.id, name: type.name, party_size: type.fixed_party_size, platter: type.included_preorder_item }));
  const bookingTypes = hasConfiguredPackages
    ? linkedTypes.filter((type: any) => !!type.included_preorder_item_id)
    : linkedTypes;

  // FR-E1: remaining availability (cap minus sold and in-flight holds).
  const remaining: Record<string, number | null> = {};
  const sold: Record<string, number> = {};
  if (!isReservation) {
    const { data: avail } = await supabase.rpc("availability", { p_event_id: ev.id });
    for (const a of (avail ?? []) as any[]) {
      remaining[a.ticket_type_id] = a.remaining;
      sold[a.ticket_type_id] = a.sold;
    }
  }

  // The organiser's wording wins over computed hours (e.g. "From 6:00 AM till late").
  const timeLabel = ev.time_note || nairobiTimeRange(ev.starts_at, ev.ends_at);

  // Get tickets only (2026-10-07): the hero, facts, program, concept and vendor
  // sign-up all live on /events now, so this page is just the event's name and
  // the booking panel — nothing repeated.
  return (
    <AppShell title="Get tickets" back="/events" wideEvent>
      <div className="pad tk-page">
        <header className="tk-head">
          <span className="eyebrow">{fmt(ev.starts_at, { weekday: "long", day: "numeric", month: "long" })} · {ev.venue || "Nairobi"}</span>
          <h1>{ev.name}</h1>
          <span className="small">{timeLabel}{ev.dress_code ? ` · Dress code: ${ev.dress_code}` : ""}</span>
        </header>

        <section className="event-booking tk-booking" aria-label={isReservation ? "Reserve your place" : "Buy tickets"}>
          {notOpenYet ? (
            <div className="card stack tight">
              <span className="pill warn" style={{ justifySelf: "start" }}>Coming soon</span>
              <strong>Registration details coming soon.</strong>
              <span className="small">Check back here — this is where registration will open.</span>
            </div>
          ) : isReservation && gaType ? (
            <GetTicketsPanel event={ev as Event} gaTypeId={gaType.id} options={upgradeOptions} />
          ) : isReservation ? (
            <ReservationForm
              event={ev as Event}
              items={(preorderItems ?? []) as PreorderItem[]}
              types={bookingTypes as ReservationType[]}
            />
          ) : (
            <EventCheckout
              event={ev as Event}
              types={(types ?? []) as TicketType[]}
              remaining={remaining}
              sold={sold}
            />
          )}
        </section>
        <div className="bottom-gap" />
      </div>
    </AppShell>
  );
}
