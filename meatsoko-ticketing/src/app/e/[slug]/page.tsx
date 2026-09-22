import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/AppShell";
import Icon from "@/components/Icon";
import EventCheckout from "@/components/EventCheckout";
import ReservationForm from "@/components/ReservationForm";
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

  // A conference/expo sells on what's inside, not on a lineup. Until zones are
  // first-class data, read them from the description: "Butchery | Grills | Talks".
  const zones = (ev.description ?? "").includes("|")
    ? ev.description.split("|").map((z: string) => z.trim()).filter(Boolean)
    : [];
  const blurb = zones.length ? "" : (ev.description ?? "");

  return (
    <AppShell transparentBar>
      <section className="hero">
        {ev.banner_url
          ? <img src={ev.banner_url} alt="" />
          : <div className="hero-fallback" aria-hidden="true" />}
        <div className="hero-inner">
          <span className="pill glass">
            {ev.format === "conference_expo" ? "Expo" : "Festival"}
          </span>
          <h1>{ev.name}</h1>
          {ev.tagline && <p className="small" style={{ color: "rgba(255,255,255,.88)" }}>{ev.tagline}</p>}
          <div className="meta">
            <span className="pill glass">
              <Icon name="pin" size={13} /> {ev.venue || "Nairobi"}
            </span>
            <span className="pill glass">
              <Icon name="clock" size={13} />
              {fmt(ev.starts_at, { hour: "numeric", minute: "2-digit", hour12: true })}
              {ev.ends_at && ev.ends_at !== ev.starts_at
                ? ` – ${fmt(ev.ends_at, { hour: "numeric", minute: "2-digit", hour12: true })}`
                : ""}
            </span>
          </div>
        </div>
      </section>

      <div className="pad">
        <div className="row">
          <div className="stack tight">
            <span className="eyebrow">
              {fmt(ev.starts_at, { weekday: "long" })}
            </span>
            <strong style={{ fontSize: "1.05rem" }}>
              {fmt(ev.starts_at, { day: "numeric", month: "long", year: "numeric" })}
            </strong>
          </div>
          {/* The one element people screenshot and remember. */}
          <span className="datestamp" aria-hidden="true">
            <span className="d num">{fmt(ev.starts_at, { day: "numeric" })}</span>
            <span className="m">{fmt(ev.starts_at, { month: "short" })}</span>
          </span>
        </div>

        {zones.length > 0 && (
          <div className="stack tight">
            <span className="eyebrow">What&apos;s inside</span>
            <div className="scroller">
              {zones.map((z: string) => <span className="pill" key={z}>{z}</span>)}
            </div>
          </div>
        )}

        {blurb && <p className="small">{blurb}</p>}

        {isReservation ? (
          <ReservationForm
            event={ev as Event}
            items={(preorderItems ?? []) as PreorderItem[]}
            types={(reservationTypes ?? []) as ReservationType[]}
          />
        ) : (
          <EventCheckout
            event={ev as Event}
            types={(types ?? []) as TicketType[]}
            remaining={remaining}
            sold={sold}
          />
        )}

        <div className="bottom-gap" />
      </div>
    </AppShell>
  );
}
