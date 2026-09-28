import Link from "next/link";
import Image from "next/image";
import { StoreFooter, StoreHeader, StoreMobileBar } from "@/components/StoreChrome";
import MerchandiseCard from "@/components/MerchandiseCard";
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
    .select("slug, name, venue, starts_at")
    .eq("status", "live")
    .gte("ends_at", now)
    .order("starts_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const currentEventHref = currentEvent?.slug ? `/e/${currentEvent.slug}` : "/events";

  return (
    <div className="storefront">
      <div className="store-announcement">MEATSOKO · GOOD THINGS FOR GOOD GATHERINGS</div>
      <StoreHeader />
      <main>
        <section className="store-hero">
          <div className="store-hero-copy">
            <span className="store-eyebrow">THE MEATSOKO COLLECTION</span>
            <h1>Wear the<br />good times<span>.</span></h1>
            <p>Everyday pieces for people who bring good food and good people together.</p>
            <Link href="/shop" className="store-button">Shop merchandise <span>↗</span></Link>
            <small>MEATSOKO MERCHANDISE&nbsp; · &nbsp;THE NYAMAFEST COLLECTION</small>
          </div>
          <div className="store-hero-art" aria-label="NyamaFest green hoodie from the current merchandise collection">
            <Image src={merchandiseCategories[0].products[0].image} alt="NyamaFest hoodie in green" fill priority sizes="(max-width: 760px) 100vw, 52vw" />
            <div className="hero-art-caption">THE NYAMAFEST DROP<br/><strong>01 / EVERYDAY</strong></div>
          </div>
        </section>

        <section className="store-intro">
          <span className="store-eyebrow">GOOD THINGS, MADE TO GO PLACES</span>
          <h2>A little MeatSoko,<br className="mobile-break"/> wherever you go.</h2>
          <p>Shop the pieces you know from our gatherings, plus new everyday favourites.</p>
          <div className="store-promises"><span>Thoughtful drops</span><span>Easy Kenyan checkout</span><span>Pickup or delivery</span></div>
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
            {featuredProducts.map((product) => <MerchandiseCard key={product.image} product={product} />)}
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
      <StoreFooter />
      <StoreMobileBar />
    </div>
  );
}
