import Link from "next/link";
import BagProvider from "@/components/store/BagProvider";
import BagDrawer, { BagButton } from "@/components/store/BagDrawer";
import StoreSearch from "@/components/store/StoreSearch";
import { SUPPORT } from "@/lib/support";

export function StoreHeader() {
  return (
    <header className="store-header">
      <details className="store-mobile-menu">
        <summary aria-label="Open navigation menu"><span/><span/><span/></summary>
        <nav className="store-mobile-menu-panel" aria-label="Mobile navigation">
          <Link href="/shop">Shop all merchandise <span>↗</span></Link>
          <Link href="/shop#partnerships">Partnerships <span>↗</span></Link>
          <Link href="/#collections">Collections <span>↗</span></Link>
          <Link href="/events">Events and tickets <span>↗</span></Link>
          <Link href="/cart">Your bag <span>↗</span></Link>
        </nav>
      </details>
      <Link href="/" className="store-brand" aria-label="MeatSoko home">
        <span className="store-mark">M</span><span>MEATSOKO</span>
      </Link>
      <nav className="store-nav" aria-label="Main navigation">
        <Link href="/shop">Shop</Link>
        <Link href="/#collections">Collections</Link>
        <Link href="/events">Events</Link>
      </nav>
      <div className="store-actions">
        <StoreSearch />
        <BagButton />
      </div>
    </header>
  );
}

export function StoreMobileBar() {
  return (
    <nav className="store-mobile-bar" aria-label="Quick navigation">
      <Link href="/" aria-label="Home"><span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-6v-7h-4v7H4a1 1 0 0 1-1-1V10Z"/></svg></span><small>Home</small></Link>
      <Link href="/shop" aria-label="Shop"><span aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/></svg></span><small>Shop</small></Link>
      <Link href="/events" aria-label="Events"><span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 8V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 8v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-8Z"/><path d="M15 5v14" strokeDasharray="2 2"/></svg></span><small>Events</small></Link>
      <Link href="/cart" aria-label="Shopping bag"><span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 8h14l1 13H4L5 8Z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/></svg></span><small>Bag</small></Link>
    </nav>
  );
}

export function StoreFooter() {
  return (
    <footer className="store-footer">
      <div className="store-footer-top">
        {/* Behind the links, standing on the divider line. SVG + textLength keeps the whole
            word inside the block at any width: it scales to whichever of width or height runs out first. */}
        <svg className="store-footer-word" viewBox="0 0 1000 160" preserveAspectRatio="xMidYMax meet" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id="footer-word-fade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#fff" stopOpacity=".07" />
              <stop offset="1" stopColor="#fff" stopOpacity=".015" />
            </linearGradient>
          </defs>
          <text x="500" y="160" textAnchor="middle" textLength="992" lengthAdjust="spacingAndGlyphs" fill="url(#footer-word-fade)">MEATSOKO</text>
        </svg>
        <div className="store-footer-grid">
          <div>
            <Link href="/" className="store-brand"><span className="store-mark">M</span><span>MEATSOKO</span></Link>
            <p>Good things for good gatherings.</p>
          </div>
          <div><strong>SHOP</strong><Link href="/shop">All merchandise</Link><Link href="/shop#hoodies">Hoodies</Link><Link href="/shop#t-shirts">T-shirts &amp; polos</Link><Link href="/shop#headwear">Headwear</Link><Link href="/shop#workwear">Overalls &amp; dust coats</Link><Link href="/shop#partnerships">Partnerships</Link></div>
          <div><strong>HELP</strong><Link href="/cart">Your bag</Link><Link href="/lookup">Find my pass</Link><Link href="/checkout">Checkout</Link><Link href="/returns">Returns &amp; exchanges</Link><a href={SUPPORT.tel}>Call {SUPPORT.display}</a><a href={SUPPORT.whatsapp} target="_blank" rel="noopener noreferrer">WhatsApp us</a></div>
          <div><strong>EVENTS</strong><Link href="/events">Upcoming events</Link><Link href="/events">Tickets</Link></div>
        </div>
      </div>
      <div className="store-footer-base">
        <small>© MeatSoko {new Date().getFullYear()}</small>
        <small>Secure checkout by Paystack · M-Pesa &amp; cards</small>
      </div>
    </footer>
  );
}

/** Every storefront page: announcement, header, the bag (context + drawer), footer. */
export function StoreShell({ children }: { children: React.ReactNode }) {
  return (
    <BagProvider>
      <div className="storefront">
        <div className="store-announcement">MEATSOKO · GOOD THINGS FOR GOOD GATHERINGS</div>
        <StoreHeader />
        {children}
        <StoreFooter />
        <StoreMobileBar />
        <BagDrawer />
      </div>
    </BagProvider>
  );
}
