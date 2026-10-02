import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/AppShell";
import Icon from "@/components/Icon";
import EventCheckout from "@/components/EventCheckout";
import ReservationForm from "@/components/ReservationForm";
import GetTicketsPanel from "@/components/GetTicketsPanel";
import ShareBar from "@/components/event/ShareBar";
import EventTabs from "@/components/event/EventTabs";
import { SUPPORT } from "@/lib/support";
import VendorSignup from "@/components/VendorSignup";
import type { UpgradeOption } from "@/components/TableUpgrade";
import EarlyBirdCountdown from "@/components/EarlyBirdCountdown";
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

  const { data: types } = isReservation ? { data: [] } : await supabase.from("ticket_types").select("*")
    .eq("event_id", ev.id).eq("is_active", true).order("position");

  const { data: preorderItems } = isReservation
    ? await supabase.from("preorder_items").select("*")
        .eq("event_id", ev.id).eq("is_active", true).order("position")
    : { data: [] };
  const earlyBirdEndsAt = (preorderItems ?? []).find(
    (item: any) => item.early_bird_ends_at && item.compare_at_price_kes
  )?.early_bird_ends_at;

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

  // A conference/expo sells on what's inside, not on a lineup. Until zones are
  // first-class data, read them from the description: "Butchery | Grills | Talks".
  const zones = (ev.description ?? "").includes("|")
    ? ev.description.split("|").map((z: string) => z.trim()).filter(Boolean)
    : [];
  const blurb = zones.length ? "" : (ev.description ?? "");
  const timeLabel = nairobiTimeRange(ev.starts_at, ev.ends_at);
  const pageUrl = `${(process.env.NEXT_PUBLIC_APP_URL ?? "https://event.meatsokogroup.com").replace(/\/$/, "")}/e/${ev.slug}`;

  return (
    <AppShell transparentBar wideEvent>
      <section className="hero">
        {ev.banner_url
          ? <img src={ev.banner_url} alt="" />
          : <div className="hero-fallback" aria-hidden="true" />}
        <div className="hero-inner">
          {earlyBirdEndsAt && <EarlyBirdCountdown endsAt={earlyBirdEndsAt} />}
          <h1>{ev.name}</h1>
          {ev.tagline && <p className="small" style={{ color: "rgba(255,255,255,.88)" }}>{ev.tagline}</p>}
          <div className="meta">
            <span className="pill glass">
              <Icon name="pin" size={13} /> {ev.venue || "Nairobi"}
            </span>
            <span className="pill glass">
              <Icon name="clock" size={13} />
              {timeLabel}
            </span>
          </div>
          <VendorSignup eventId={ev.id} eventName={ev.name} />
        </div>
      </section>

      <div className="pad">
        <div className="event-purchase-layout">
          <section className="event-overview" aria-label="Event details">
            <div className="row event-date-summary">
              <div className="stack tight">
                <span className="eyebrow">
                  {fmt(ev.starts_at, { weekday: "long" })}
                </span>
                <strong style={{ fontSize: "1.05rem" }}>
                  {fmt(ev.starts_at, { day: "numeric", month: "long", year: "numeric" })}
                </strong>
              </div>
              <span className="datestamp" aria-hidden="true">
                <span className="d num">{fmt(ev.starts_at, { day: "numeric" })}</span>
                <span className="m">{fmt(ev.starts_at, { month: "short" })}</span>
              </span>
            </div>

            {/* What, where, how you get in — the questions a buyer has before paying. */}
            <dl className="event-facts">
              <div><dt>When</dt><dd>{fmt(ev.starts_at, { weekday: "short", day: "numeric", month: "short" })} · {timeLabel}</dd></div>
              <div><dt>Where</dt><dd>{ev.venue || "Nairobi"}</dd></div>
              <div><dt>Entry</dt><dd>QR scan at the gate</dd></div>
            </dl>
            <div className="event-trust">
              {gaType && <span>Free entry</span>}
              <span>Instant QR</span>
              <span>M-Pesa &amp; card</span>
              <a href={SUPPORT.whatsapp} target="_blank" rel="noopener noreferrer">Help: {SUPPORT.display}</a>
            </div>
            <ShareBar url={pageUrl} title={ev.name} />

            <EventTabs
              eventName={ev.name}
              lineup={ev.lineup}
              venue={ev.venue}
              tablePlanUrl={ev.table_plan_url}
              overview={<>
              {zones.length > 0 && (
                <div className="stack tight event-zones-panel">
                  <span className="eyebrow">What&apos;s inside</span>
                  <div className="scroller">
                    {zones.map((z: string) => <span className="pill" key={z}>{z}</span>)}
                  </div>
                </div>
              )}

              {blurb && <p className="small event-description">{blurb}</p>}
              </>}
            />
          </section>

          <section className="event-booking" aria-label={isReservation ? "Reserve your place" : "Buy tickets"}>
            {isReservation && gaType ? (
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
        </div>
        <div className="bottom-gap" />
      </div>
    </AppShell>
  );
}
