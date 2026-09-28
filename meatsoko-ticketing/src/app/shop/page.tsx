import Link from "next/link";
import { StoreShell } from "@/components/StoreChrome";

export default function ShopPage() {
  return (
    <StoreShell>
      <main className="store-subpage">
        <div className="store-breadcrumb"><Link href="/">Home</Link><span>/</span><span>Shop</span></div>
        <span className="store-eyebrow">THE MEATSOKO COLLECTION</span>
        <h1>Shop merchandise</h1>
        <p className="store-subpage-intro">Pieces for the people, places, and moments that make a gathering. The first collection is on its way.</p>
        <div className="shop-collection-note"><span>COLLECTIONS</span><strong>Product categories will be added with the final catalog.</strong></div>
        <div className="store-empty-panel shop-empty">
          <div className="shop-placeholder-mark">M</div>
          <strong>We’re getting the first drop ready.</strong>
          <p>Product photos, category names, and prices will appear here once the collection is finalized.</p>
          <Link href="/events" className="store-back-link">In the meantime, explore MeatSoko events →</Link>
        </div>
      </main>
    </StoreShell>
  );
}
