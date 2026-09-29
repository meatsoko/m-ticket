import Link from "next/link";
import { StoreShell } from "@/components/StoreChrome";
import MerchandiseCard from "@/components/MerchandiseCard";
import { merchandiseCategories, searchProducts, allProducts } from "@/lib/merchandise";

export default function ShopPage({ searchParams }: { searchParams?: { q?: string } }) {
  const q = (searchParams?.q ?? "").trim().slice(0, 80);
  const results = q ? searchProducts(q, allProducts.length) : [];

  return (
    <StoreShell>
      <main className="store-subpage">
        <div className="store-breadcrumb"><Link href="/">Home</Link><span>/</span>{q ? <><Link href="/shop">Shop</Link><span>/</span><span>Search</span></> : <span>Shop</span>}</div>
        <span className="store-eyebrow">THE MEATSOKO COLLECTION</span>
        <h1>{q ? <>Results for “{q}”</> : "Shop merchandise"}</h1>
        {q ? (
          <>
            <p className="store-subpage-intro">{results.length} piece{results.length === 1 ? "" : "s"} found. <Link href="/shop" className="text-link">Clear search</Link></p>
            {results.length ? (
              <div className="merch-product-grid shop-search-grid">
                {results.map((item) => <MerchandiseCard key={item.slug} product={item} />)}
              </div>
            ) : (
              <div className="store-empty-panel">
                <strong>Nothing matches that yet.</strong>
                <p>Try a style (hoodie, polo, tee, cap, beanie) or a colour (green, white, red).</p>
                <Link href="/shop" className="store-button">Browse everything <span>↗</span></Link>
              </div>
            )}
          </>
        ) : (
          <>
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
                    {category.products.map((item) => <MerchandiseCard key={item.slug} product={item} />)}
                  </div>
                </section>
              ))}
            </div>
          </>
        )}
      </main>
    </StoreShell>
  );
}
