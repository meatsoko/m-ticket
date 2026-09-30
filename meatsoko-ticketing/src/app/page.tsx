import Link from "next/link";
import Image from "next/image";
import { StoreShell } from "@/components/StoreChrome";
import MerchandiseCard from "@/components/MerchandiseCard";
import HeroCarousel, { type HeroEvent } from "@/components/store/HeroCarousel";
import { merchandiseCategories } from "@/lib/merchandise";
import { createClient } from "@/lib/supabase/server";

const featuredProducts = [
  merchandiseCategories[0].products[0],
  merchandiseCategories[1].products[0],
  merchandiseCategories[2].products[0],
  merchandiseCategories[3].products[1],
];

export default async function Home() {
  const supabase = createClient();
  const now = new Date().toISOString();
  const { data: currentEvent } = await supabase.from("events")
    .select("id, slug, name, venue, starts_at, ends_at, banner_url")
    .eq("status", "live")
    .gte("ends_at", now)
    .order("starts_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const currentEventHref = currentEvent?.slug ? `/e/${currentEvent.slug}` : "/events";

  // The same event as a ticket card in the hero slideshow. Dates in Nairobi time.
  let heroEvent: HeroEvent | null = null;
  if (currentEvent) {
    const { count: gaTypes } = await supabase.from("reservation_types").select("id", { count: "exact", head: true })
      .eq("event_id", currentEvent.id).eq("is_general_admission", true).eq("is_active", true);
    const tz = { timeZone: "Africa/Nairobi" } as const;
    const d = new Date(currentEvent.starts_at);
    const day = Number(new Intl.DateTimeFormat("en-KE", { ...tz, day: "numeric" }).format(d));
    const suffix = [11, 12, 13].includes(day % 100) ? "TH" : ({ 1: "ST", 2: "ND", 3: "RD" } as Record<number, string>)[day % 10] ?? "TH";
    const month = new Intl.DateTimeFormat("en-US", { ...tz, month: "short" }).format(d).toUpperCase();
    const clock = (iso: string) => new Intl.DateTimeFormat("en-US", { ...tz, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
    heroEvent = {
      slug: currentEvent.slug, name: currentEvent.name, venue: currentEvent.venue || "Nairobi",
      image: currentEvent.banner_url,
      dateBig: `${month} ${day}${suffix}`,
      year: new Intl.DateTimeFormat("en-KE", { ...tz, year: "numeric" }).format(d),
      dateShort: `${day} ${month} ${new Intl.DateTimeFormat("en-KE", { ...tz, year: "numeric" }).format(d)}`,
      time: currentEvent.slug === "nyamafest-main" ? `${clock(currentEvent.starts_at)} till dawn`
        : currentEvent.ends_at && currentEvent.ends_at !== currentEvent.starts_at ? `${clock(currentEvent.starts_at)} – ${clock(currentEvent.ends_at)}` : clock(currentEvent.starts_at),
      note: gaTypes ? "Free entry · tables available" : "Tickets on sale now",
    };
  }

  return (
    <StoreShell>
      <main>
        <section className="store-hero-screen">
          <div className="store-hero">
            <div className="store-hero-copy">
              <span className="store-eyebrow">THE MEATSOKO COLLECTION</span>
              <h1>Wear the<br />good times<span>.</span></h1>
              <p>Everyday pieces for people who bring good food and good people together.</p>
              <div className="hero-actions">
                <Link href="/shop" className="store-button">Shop merchandise <span>↗</span></Link>
                <Link href={currentEventHref} className="store-button store-button-outline">Book ticket <span>↗</span></Link>
              </div>
              <small>MEATSOKO MERCHANDISE&nbsp; · &nbsp;THE NYAMAFEST COLLECTION</small>
            </div>
            <HeroCarousel event={heroEvent} />
          </div>
          <div className="store-promises" aria-label="Why shop with us"><span>Thoughtful drops</span><span>Easy Kenyan checkout</span><span>Pickup or delivery</span></div>
        </section>

        <section className="store-section" id="collections">
          <div className="section-heading"><div><span className="store-eyebrow">FIND YOUR THING</span><h2>Shop by category</h2></div><Link href="/shop">View shop <span>→</span></Link></div>
          <div className="category-grid">
            {merchandiseCategories.map((category) => <Link href={`/shop#${category.id}`} className="category-card" key={category.id}>
              <Image src={category.products[0].image} alt={`${category.name} collection`} fill sizes="(max-width: 760px) 80vw, 25vw" />
              <strong>{category.name}<span>↗</span></strong>
            </Link>)}
          </div>
        </section>

        <section className="store-section popular-section">
          <div className="section-heading"><div><span className="store-eyebrow">THE NYAMAFEST COLLECTION</span><h2>Featured pieces</h2></div><Link href="/shop">View all products <span>→</span></Link></div>
          <div className="merch-product-grid featured-product-grid">
            {featuredProducts.map((product) => <MerchandiseCard key={product.slug} product={product} />)}
          </div>
        </section>

        <section className="store-campaign">
          <div className="campaign-image">
            <Image src="/images/campaign/nyamafest-poster.jpeg" alt="NyamaFest poster featuring grilled food and live entertainment" fill sizes="(max-width: 760px) 100vw, 50vw" />
          </div>
          <div><span className="store-eyebrow">THE GATHERING EDIT</span><h2>Made for the<br/>moments between.</h2><p>A collection inspired by long tables, loud laughs, and one more plate.</p><Link href="/shop" className="store-button store-button-light">Explore the collection <span>↗</span></Link></div>
        </section>

        <section className="events-teaser">
          <div><span className="store-eyebrow">THE TICKETED SIDE OF MEATSOKO</span><h2>Come through.</h2><p>Find the next gathering and book your place.</p><Link href="/events" className="store-button">Browse events <span>↗</span></Link></div>
          <Link href={currentEventHref} className="event-teaser-link"><span className="event-date-mark">MS</span><span><small>MEATSOKO EVENTS</small><strong>{currentEvent?.name ?? "See the upcoming event"}</strong><small>{currentEvent?.venue ?? "Event details and tickets"} <b>→</b></small></span><span className="event-arrow">↗</span></Link>
        </section>
      </main>
    </StoreShell>
  );
}
