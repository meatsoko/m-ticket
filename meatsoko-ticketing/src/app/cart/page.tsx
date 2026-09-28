import Link from "next/link";
import { StoreShell } from "@/components/StoreChrome";

export default function CartPage() {
  return (
    <StoreShell>
      <main className="store-subpage">
        <div className="store-breadcrumb"><Link href="/">Home</Link><span>/</span><span>Your bag</span></div>
        <span className="store-eyebrow">YOUR PICKS</span>
        <h1>Your bag</h1>
        <div className="store-empty-panel cart-empty">
          <div className="bag-outline" aria-hidden="true">◇</div>
          <strong>Your bag is empty.</strong>
          <p>When you find something you like, it’ll show up here with its options and price.</p>
          <Link href="/shop" className="store-button">Explore the shop <span>↗</span></Link>
        </div>
      </main>
    </StoreShell>
  );
}
