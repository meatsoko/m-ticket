import Link from "next/link";
import AppShell from "@/components/AppShell";
import Icon from "@/components/Icon";
import { createClient } from "@/lib/supabase/server";
import EventsHero from "@/components/event/EventsHero";
import { cheapestTableLabel, type HeroPlatter } from "@/lib/hero-price";
import FeaturedEvents, { type FeaturedItem } from "@/components/event/FeaturedEvents";
import ConceptHighlight from "@/components/event/ConceptHighlight";
import ProgramSection from "@/components/event/ProgramSection";
import VendorSignup from "@/components/VendorSignup";
import { displayFont } from "@/lib/fonts";
import type { EventConcept, EventProgramItem } from "@/lib/types";

/** Pictures for events that have no banner of their own. */
const STAND_IN_IMAGES = [
  "/images/events/nyamafest-main-poster.webp",
  "/images/table-packages/big-family.webp",
  "/images/table-packages/moderate-family.webp",
  "/images/table-packages/basic-family.webp",
];

const KE = "Africa/Nairobi";
const fmt = (iso: string, o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-KE", { timeZone: KE, ...o }).format(new Date(iso));

type Phase = "past" | "now" | "soon";

/**
 * The events module: the next open event as the hero, every event in the
 * Featured events rail (open and announced ones link to their page; past ones
 * don't), the next event's program and concept ("Read more…" to the full
 * article), then Plan a celebration and Become a vendor. /e/<slug> is tickets only.
 */
export default async function EventsPage() {
  const supabase = createClient();
  const { data: events } = await supabase
    .from("events").select("*").neq("status", "draft").order("starts_at");

  const list = events ?? [];

  const phaseOf = (e: any): Phase => {
    if (e.status === "closed") return "past";
    // An event whose day has passed is history even if nobody closed it.
    if (new Date(e.ends_at ?? e.starts_at).getTime() < Date.now()) return "past";
    // "Coming soon" is an announced event whose reservation window has not
    // opened yet — the same rule create_reservation() enforces server-side.
    const opens = e.reservations_open_at ? new Date(e.reservations_open_at).getTime() : null;
    if (opens !== null && opens > Date.now()) return "soon";
    if (e.reservations_close_at && new Date(e.reservations_close_at).getTime() < Date.now()) return "past";
    return "now";
  };

  // General Admission events say "Free entry · tables available" on the ticket.
  const openIds = list.filter((e: any) => phaseOf(e) === "now").map((e: any) => e.id);
  const { data: ga } = openIds.length
    ? await supabase.from("reservation_types").select("event_id").in("event_id", openIds).eq("is_general_admission", true).eq("is_active", true)
    : { data: [] as { event_id: string }[] };
  const hasGa = new Set((ga ?? []).map((r) => r.event_id));

  const open = list.filter((e: any) => phaseOf(e) === "now");
  // The hero is the first open event. Its price line is read the way the
  // event page prices it.
  const hero = open[0] ?? null;
  let priceFrom: string | null = null;
  if (hero) {
    if ((hero.reservation_mode ?? "off") !== "off") {
      const [{ data: tables }, { data: items }] = await Promise.all([
        supabase.from("reservation_types").select("included_preorder_item_id")
          .eq("event_id", hero.id).eq("is_active", true).eq("is_general_admission", false),
        supabase.from("preorder_items").select("id, name, price_kes, compare_at_price_kes, early_bird_ends_at")
          .eq("event_id", hero.id).eq("is_active", true),
      ]);
      const ids = new Set((tables ?? []).map((t: any) => t.included_preorder_item_id).filter(Boolean));
      priceFrom = cheapestTableLabel((items ?? []).filter((i: any) => ids.has(i.id)) as HeroPlatter[], Date.now());
    } else {
      const { data: types } = await supabase.from("ticket_types").select("price_kes").eq("event_id", hero.id).eq("is_active", true);
      const prices = (types ?? []).map((t: any) => Number(t.price_kes)).filter((n) => n > 0);
      if (prices.length) priceFrom = `KSh ${Math.min(...prices).toLocaleString("en-KE")}`;
    }
  }
  const soon = list.filter((e: any) => phaseOf(e) === "soon");
  const past = list.filter((e: any) => phaseOf(e) === "past").reverse();

  // Featured events: open, then announced, then past (newest first). Events
  // without a banner (the two closed September NyamaFests) borrow MeatSoko
  // food photos so every card has a picture.
  let spare = 0;
  const featured: FeaturedItem[] = [...open, ...soon, ...past].map((e: any) => {
    const phase = phaseOf(e);
    return {
      id: e.id, title: e.name,
      when: `${fmt(e.starts_at, { weekday: "short" })}, ${fmt(e.starts_at, { day: "2-digit", month: "short" })}`,
      venue: (e.venue || "Nairobi").split(",")[0],
      image: e.banner_url || STAND_IN_IMAGES[spare++ % STAND_IN_IMAGES.length],
      href: phase === "past" ? null : `/e/${e.slug}`,
      tag: phase === "past" ? "Past event" : phase === "soon" ? "Coming soon" : hasGa.has(e.id) ? "Free entry" : "Tickets on sale",
      tone: phase === "past" ? "past" : phase === "soon" ? "soon" : "open",
    };
  });

  // The hero event's program and concept (the event page itself is tickets only).
  const [{ data: concept }, { data: program }] = hero
    ? await Promise.all([
        supabase.from("event_concepts").select("*").eq("event_id", hero.id).maybeSingle(),
        supabase.from("event_programs").select("*").eq("event_id", hero.id).eq("is_published", true).order("position"),
      ])
    : [{ data: null }, { data: null }];
  const heroName = hero ? hero.name.replace(/\s*\bmain\b\s*/i, " ").trim() : "";

  return (
    <AppShell title="Events" wideEvent fullBleed>
      {hero && <EventsHero event={hero} freeEntry={hasGa.has(hero.id)} priceFrom={priceFrom} />}
      {featured.length > 0 && <FeaturedEvents items={featured} className={displayFont.variable} />}
      {hero && (program ?? []).length > 0 && (
        <ProgramSection items={program as EventProgramItem[]} eventName={heroName} slug={hero.slug} className={displayFont.variable} />
      )}
      {hero && concept && (
        <ConceptHighlight concept={concept as EventConcept} slug={hero.slug} eventName={heroName} className={displayFont.variable} />
      )}
      {/* Take part: occasion booking (Celebrations lives in the events module, not the
          store navigation) and, for the open event, the vendor sign-up. */}
      <section className={`cel-band ${displayFont.variable}`} aria-labelledby="cel-band-title">
        <div className="cel-band-main">
          <span className="cel-kicker">MeatSoko Celebrations</span>
          <h2 id="cel-band-title">Got your own occasion?</h2>
          <p>Birthdays, anniversaries, graduations, family days. Tell us about it and we&apos;ll plan the nyama, the grill and the setup with you.</p>
          <Link href="/celebrations">Plan a celebration <b aria-hidden="true">→</b></Link>
        </div>
        {hero && <div className="cel-band-vendor"><VendorSignup eventId={hero.id} eventName={heroName} /></div>}
      </section>
      {list.length === 0 && (
        <div className="pad">
          <div className="stack tight event-lineup-heading">
            <span className="eyebrow">MeatSoko</span>
            <h1>The line-up</h1>
          </div>
          <div className="empty">
            <Icon name="ticket" size={30} />
            <strong>Nothing announced yet</strong>
          </div>
        </div>
      )}
    </AppShell>
  );
}
