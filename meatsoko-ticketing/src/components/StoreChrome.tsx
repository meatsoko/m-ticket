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
          <Link href="/celebrations">Celebrations <span>↗</span></Link>
          <Link href="/investors">Investors <span>↗</span></Link>
          <Link href="/cart">Your bag <span>↗</span></Link>
        </nav>
      </details>
      <Link href="/" className="store-brand" aria-label="MeatSoko home">
        <img className="brand-logo" src="/images/brand/meatsoko-logo-mark.png" alt="MeatSoko" width={480} height={176} />
      </Link>
      <nav className="store-nav" aria-label="Main navigation">
        <Link href="/shop">Shop</Link>
        <Link href="/#collections">Collections</Link>
        <Link href="/events">Events</Link>
        <Link href="/celebrations">Celebrations</Link>
        <Link href="/investors">Investors</Link>
      </nav>
      <div className="store-actions">
        <StoreSearch />
        <BagButton />
      </div>
    </header>
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
            <Link href="/" className="store-brand"><img className="brand-logo" src="/images/brand/meatsoko-logo-mark.png" alt="MeatSoko" width={480} height={176} /></Link>
            <p>Good things for good gatherings.</p>
          </div>
          <div><strong>SHOP</strong><Link href="/shop">All merchandise</Link><Link href="/shop#hoodies">Hoodies</Link><Link href="/shop#t-shirts">T-shirts &amp; polos</Link><Link href="/shop#headwear">Headwear</Link><Link href="/shop#workwear">Overalls &amp; dust coats</Link><Link href="/shop#partnerships">Partnerships</Link></div>
          <div><strong>HELP</strong><Link href="/cart">Your bag</Link><Link href="/lookup">Find my pass</Link><Link href="/checkout">Checkout</Link><Link href="/returns">Returns &amp; exchanges</Link><Link href="/ticket-terms">Ticket terms</Link><a href={SUPPORT.tel}>Call {SUPPORT.display}</a><a href={SUPPORT.whatsapp} target="_blank" rel="noopener noreferrer">WhatsApp us</a></div>
          <div><strong>EVENTS</strong><Link href="/events">Upcoming events</Link><Link href="/events">Tickets</Link><Link href="/celebrations">Celebrations</Link><Link href="/investors">Investors</Link></div>
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
        <StoreHeader />
        {children}
        <StoreFooter />
        <BagDrawer />
      </div>
    </BagProvider>
  );
}
