import Link from "next/link";

export function StoreHeader() {
  return (
    <header className="store-header">
      <details className="store-mobile-menu">
        <summary aria-label="Open navigation menu"><span/><span/><span/></summary>
        <nav className="store-mobile-menu-panel" aria-label="Mobile navigation">
          <Link href="/shop">Shop all merchandise <span>↗</span></Link>
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
        <Link href="/shop" className="store-cta">Shop merchandise <span>↗</span></Link>
        <Link href="/cart" className="store-cart" aria-label="Shopping bag">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l1 13H4L5 8Z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/></svg><span>0</span>
        </Link>
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
      <div>
        <Link href="/" className="store-brand"><span className="store-mark">M</span><span>MEATSOKO</span></Link>
        <p>Good things for good gatherings.</p>
      </div>
      <div><strong>SHOP</strong><Link href="/shop">All merchandise</Link><Link href="/cart">Your bag</Link></div>
      <div><strong>EVENTS</strong><Link href="/events">Upcoming events</Link><Link href="/events">Tickets</Link></div>
      <small>© MeatSoko {new Date().getFullYear()}</small>
    </footer>
  );
}

export function StoreShell({ children }: { children: React.ReactNode }) {
  return <div className="storefront"><div className="store-announcement">MEATSOKO · GOOD THINGS FOR GOOD GATHERINGS</div><StoreHeader />{children}<StoreFooter /><StoreMobileBar /></div>;
}
