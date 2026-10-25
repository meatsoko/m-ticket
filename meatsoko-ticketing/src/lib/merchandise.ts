// Merchandise types and helpers. The catalogue itself lives in Supabase
// (merch_groups / merch_products / merch_variants, delivery in
// merch_delivery_options / merch_delivery_zones) and is loaded by
// src/lib/catalogue.ts — one source for the shop, checkout and the dashboard
// (migration 20261025090000 moved it there; before that this file held a copy
// that had drifted from what checkout charged).
//
// Prices are in US dollars, as supplied by the organiser. A null price is
// deliberate: that piece has not been priced yet and must never be guessed — the
// UI says "Price coming soon", and checkout stays closed while any bag line is
// unpriced. The server re-prices every line itself; nothing the browser sends is
// trusted.

export type MerchandiseProduct = {
  /** URL segment: /shop/<slug> */
  slug: string;
  categoryId: string;
  /** Display name of the piece; colourways sharing it render as swatches of each other. */
  style: string;
  name: string;
  color: string;
  /** CSS background for the colour swatch. */
  swatch: string;
  image: string;
  priceUsd: number | null;
  sizes: string[];
  summary: string;
  details: string[];
  partner?: string;
  /** Shown but not buyable (merch_products.sold_out). */
  outOfStock?: boolean;
  /** "whole": the photo is shown uncropped and unzoomed (wide front-and-back shots). */
  fit?: "whole";
};

export type MerchandiseCategory = {
  id: string;
  name: string;
  eyebrow: string;
  description: string;
  products: MerchandiseProduct[];
};

// Delivery as merch_delivery_options says. A null fee is "to be confirmed"
// (checkout stays closed on it); standard delivery is priced per zone instead.
export type DeliveryOption = {
  id: string;
  label: string;
  blurb: string;
  feeUsd: number | null;
  needsZone: boolean;
  needsAddress: boolean;
  needsTown: boolean;
};

export type DeliveryZone = { name: string; feeUsd: number | null };

export type StoreCatalogue = {
  categories: MerchandiseCategory[];
  delivery: { options: DeliveryOption[]; zones: DeliveryZone[] };
};

export const allProductsOf = (categories: MerchandiseCategory[]) => categories.flatMap((c) => c.products);

/** Cheapest priced zone, for "From $2" on standard delivery; null if none is priced. */
export function standardFromUsd(zones: DeliveryZone[]) {
  const fees = zones.map((z) => z.feeUsd).filter((f): f is number => f != null);
  return fees.length ? Math.min(...fees) : null;
}

/** The same piece in its other colourways — rendered as colour swatches. */
export const colourSiblings = (all: MerchandiseProduct[], p: MerchandiseProduct) => all.filter((o) => o.style === p.style);

export const relatedProducts = (all: MerchandiseProduct[], p: MerchandiseProduct, n = 4) =>
  [
    ...all.filter((o) => o.categoryId === p.categoryId && o.style !== p.style),
    ...all.filter((o) => o.categoryId !== p.categoryId && o.color === p.color),
    ...all.filter((o) => o.categoryId === p.categoryId && o.slug !== p.slug),
  ].filter((o, i, list) => o.slug !== p.slug && list.findIndex((x) => x.slug === o.slug) === i).slice(0, n);

export function searchProducts(categories: MerchandiseCategory[], query: string, limit = 6) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return categories
    .flatMap((c) => c.products.map((p) => ({ p, category: c.name })))
    .filter(({ p, category }) => {
      const hay = `${p.name} ${p.style} ${p.color} ${category} ${p.partner ?? ""} merch merchandise`.toLowerCase();
      return terms.every((t) => hay.includes(t) || hay.includes(t.replace(/s$/, "")));
    })
    .map(({ p }) => p)
    .slice(0, limit);
}

/** How a delivery option's fee reads before an area is chosen. */
export function deliveryFeeLabel(o: DeliveryOption, zones: DeliveryZone[], unset = "Fee confirmed at checkout") {
  if (o.needsZone) {
    const from = standardFromUsd(zones);
    return from != null ? `From ${formatPrice(from)}` : unset;
  }
  return o.feeUsd === 0 ? "Free" : o.feeUsd != null ? formatPrice(o.feeUsd) : unset;
}

export const formatPrice = (usd: number) => `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
