import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StoreShell } from "@/components/StoreChrome";
import MerchandiseCard from "@/components/MerchandiseCard";
import ProductPurchase from "@/components/store/ProductPurchase";
import ProductTabs from "@/components/store/ProductTabs";
import { allProductsOf, colourSiblings, formatPrice, percentOff, relatedProducts } from "@/lib/merchandise";
import { loadCatalogue } from "@/lib/catalogue";

// Rendered on first visit and kept for a minute (the catalogue's own cache time),
// so a product added in the database appears without a redeploy.
export const revalidate = 60;

async function find(slug: string) {
  const { categories } = await loadCatalogue();
  const all = allProductsOf(categories);
  const product = all.find((p) => p.slug === slug) ?? null;
  return { all, product, category: product ? categories.find((c) => c.id === product.categoryId) ?? null : null };
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const { product: p } = await find(params.slug);
  if (!p) return {};
  return {
    title: `${p.name} — ${p.color} · MeatSoko`,
    description: p.summary,
    openGraph: { title: `${p.name} — ${p.color}`, description: p.summary, images: [p.image] },
  };
}

export default async function ProductPage({ params }: { params: { slug: string } }) {
  const { all, product, category } = await find(params.slug);
  if (!product) notFound();
  const siblings = colourSiblings(all, product);
  const related = relatedProducts(all, product);
  const off = percentOff(product);

  return (
    <StoreShell>
      <main className="product-page">
        <nav className="store-breadcrumb" aria-label="Breadcrumb">
          <Link href="/">Home</Link><span>/</span>
          <Link href="/shop">Shop</Link><span>/</span>
          {category && <><Link href={`/shop#${category.id}`}>{category.name}</Link><span>/</span></>}
          <span aria-current="page">{product.style} — {product.color}</span>
        </nav>

        <div className="product-layout">
          <div className="product-gallery">
            <div className={`product-gallery-main${product.fit === "whole" ? " is-whole" : ""}`}>
              <Image src={product.image} alt={`${product.name} in ${product.color.toLowerCase()}`} fill priority sizes="(max-width: 900px) 100vw, 55vw" />
              <span className="product-badge">{product.categoryId === "partnerships" ? "PARTNERSHIP" : product.categoryId === "workwear" ? "MEATSOKO WORKWEAR" : "NYAMAFEST 2026"}</span>
            </div>
          </div>

          <div className="product-summary">
            <span className="store-eyebrow">{category?.name ?? "Merchandise"} · {category?.eyebrow ?? "MEATSOKO"}</span>
            <h1>{product.name} <span>— {product.color}</span></h1>
            {product.partner && <span className="product-partner">In partnership with {product.partner}</span>}
            <p className="product-lede">{product.summary}</p>
            <div className="product-price">
              {product.priceKes != null ? (
                <span className="price-now">
                  <strong>{formatPrice(product.priceKes)}</strong>
                  {off != null && <span className="price-off">{off}% off</span>}
                </span>
              ) : <><strong>Price coming soon</strong><small>Not available to buy yet.</small></>}
            </div>

            <div className="product-option">
              <div className="product-option-label"><span>Colour</span><strong>{product.color}</strong></div>
              <div className="colour-swatches">
                {siblings.map((s) => (
                  <Link
                    key={s.slug}
                    href={`/shop/${s.slug}`}
                    className={s.slug === product.slug ? "active" : undefined}
                    aria-label={`${s.color}${s.slug === product.slug ? " (selected)" : ""}`}
                    aria-current={s.slug === product.slug ? "true" : undefined}
                    title={s.color}
                    style={{ ["--swatch" as string]: s.swatch }}
                  />
                ))}
              </div>
            </div>

            <ProductPurchase product={product} />

            <ul className="product-trust">
              <li><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18M7 15h4" /></svg><span><strong>Secure checkout</strong>M-Pesa &amp; cards via Paystack</span></li>
              <li><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z" /><circle cx="7" cy="17.5" r="1.6" /><circle cx="17" cy="17.5" r="1.6" /></svg><span><strong>Countrywide</strong>Delivery, Sacco or pickup</span></li>
              <li><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4" /></svg><span><strong>Returns</strong><a href="#delivery-returns">See our policy</a></span></li>
            </ul>

            <dl className="product-meta">
              <div><dt>Style</dt><dd>{product.style}</dd></div>
              <div><dt>Category</dt><dd>{category ? <Link href={`/shop#${category.id}`}>{category.name}</Link> : "—"}</dd></div>
              <div><dt>Sizes</dt><dd>{product.sizes.join(" · ")}</dd></div>
            </dl>
          </div>
        </div>

        <ProductTabs product={product} />

        {related.length > 0 && (
          <section className="product-related">
            <div className="section-heading"><div><span className="store-eyebrow">COMPLETE THE LOOK</span><h2>You may also like</h2></div><Link href="/shop">View all <span>→</span></Link></div>
            <div className="merch-product-grid featured-product-grid">
              {related.map((p) => <MerchandiseCard key={p.slug} product={p} />)}
            </div>
          </section>
        )}
      </main>
    </StoreShell>
  );
}
