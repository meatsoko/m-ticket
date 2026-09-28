import Link from "next/link";
import { StoreFooter, StoreHeader, StoreMobileBar } from "@/components/StoreChrome";

const categories = ["Category to be confirmed", "Category to be confirmed", "Category to be confirmed"];

export default function Home() {
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
            <small>MEATSOKO MERCHANDISE&nbsp; · &nbsp;NEW COLLECTION COMING SOON</small>
          </div>
          <div className="store-hero-art" aria-label="Merchandise collection image coming soon">
            <div className="hero-art-orbit orbit-one"/><div className="hero-art-orbit orbit-two"/>
            <div className="hero-art-card"><span>MEAT<br/>SOKO</span></div>
            <div className="hero-art-caption">COLLECTION<br/><strong>01 / EVERYDAY</strong></div>
            <span className="image-note">Your campaign image<br/>will go here</span>
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
            {categories.map((category, i) => <Link href="/shop" className={`category-card category-${i + 1}`} key={category}>
              <span className="category-image-note">Category and product<br/>imagery coming soon</span>
              <strong>{category}<span>↗</span></strong>
            </Link>)}
          </div>
        </section>

        <section className="store-section popular-section">
          <div className="section-heading"><div><span className="store-eyebrow">THE CURRENT FAVOURITES</span><h2>Popular right now</h2></div><Link href="/shop">View all products <span>→</span></Link></div>
          <div className="products-empty">
            <div className="product-placeholder-grid" aria-hidden="true"><i/><i/><i/><i/></div>
            <strong>Your next favourite is on its way.</strong>
            <p>Product photos and prices are being prepared.</p>
            <Link href="/shop" className="text-link">Explore the shop <span>→</span></Link>
          </div>
        </section>

        <section className="store-campaign">
          <div className="campaign-image"><span>Campaign image<br/>coming soon</span></div>
          <div><span className="store-eyebrow">THE GATHERING EDIT</span><h2>Made for the<br/>moments between.</h2><p>A collection inspired by long tables, loud laughs, and one more plate.</p><Link href="/shop" className="store-button store-button-light">Explore the collection <span>↗</span></Link></div>
        </section>

        <section className="events-teaser">
          <div><span className="store-eyebrow">THE TICKETED SIDE OF MEATSOKO</span><h2>Come through.</h2><p>Find the next gathering and book your place.</p><Link href="/events" className="store-button">Browse events <span>↗</span></Link></div>
          <Link href="/events" className="event-teaser-link"><span className="event-date-mark">MS</span><span><small>MEATSOKO EVENTS</small><strong>See the upcoming line-up</strong><small>Event details and tickets <b>→</b></small></span><span className="event-arrow">↗</span></Link>
        </section>
      </main>
      <StoreFooter />
      <StoreMobileBar />
    </div>
  );
}
