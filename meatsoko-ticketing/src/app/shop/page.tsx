import Link from "next/link";
import { StoreShell } from "@/components/StoreChrome";
import MerchandiseCard from "@/components/MerchandiseCard";
import { merchandiseCategories } from "@/lib/merchandise";

export default function ShopPage() {
  return (
    <StoreShell>
      <main className="store-subpage">
        <div className="store-breadcrumb"><Link href="/">Home</Link><span>/</span><span>Shop</span></div>
        <span className="store-eyebrow">THE MEATSOKO COLLECTION</span>
        <h1>Shop merchandise</h1>
        <p className="store-subpage-intro">Pieces for the people, places, and moments that make a gathering.</p>
        <div className="shop-collection-note"><span>THE COLLECTION</span><strong>Four collections · Prices coming soon</strong></div>
        <nav className="shop-category-nav" aria-label="Merchandise categories">
          {merchandiseCategories.map((category) => (
            <a href={`#${category.id}`} key={category.id}>{category.name}<span>{category.products.length}</span></a>
          ))}
        </nav>
        <div className="shop-collections">
          {merchandiseCategories.map((category) => (
            <section className="shop-category-section" id={category.id} key={category.id}>
              <div className="shop-category-heading">
                <div><span className="store-eyebrow">NYAMAFEST MERCHANDISE</span><h2>{category.name}</h2></div>
                <p>{category.description}</p>
              </div>
              <div className="merch-product-grid">
                {category.products.map((item) => <MerchandiseCard key={item.image} product={item} />)}
              </div>
            </section>
          ))}
        </div>
      </main>
    </StoreShell>
  );
}
