"use client";

import { createContext, useContext, useMemo } from "react";
import { allProductsOf, searchProducts, standardFromKes, type MerchandiseProduct, type StoreCatalogue } from "@/lib/merchandise";

// The catalogue the server loaded (src/lib/catalogue.ts), for the client parts of
// the store: the bag, search and checkout. StoreShell provides it on every page.

type Catalogue = StoreCatalogue & {
  products: MerchandiseProduct[];
  getProduct: (slug: string) => MerchandiseProduct | null;
  search: (query: string, limit?: number) => MerchandiseProduct[];
  standardFromKes: number | null;
};

const CatalogueContext = createContext<Catalogue | null>(null);

export default function CatalogueProvider({ catalogue, children }: { catalogue: StoreCatalogue; children: React.ReactNode }) {
  const value = useMemo<Catalogue>(() => {
    const products = allProductsOf(catalogue.categories);
    const bySlug = new Map(products.map((p) => [p.slug, p]));
    return {
      ...catalogue,
      products,
      getProduct: (slug) => bySlug.get(slug) ?? null,
      search: (query, limit) => searchProducts(catalogue.categories, query, limit),
      standardFromKes: standardFromKes(catalogue.delivery.zones),
    };
  }, [catalogue]);
  return <CatalogueContext.Provider value={value}>{children}</CatalogueContext.Provider>;
}

export function useCatalogue() {
  const c = useContext(CatalogueContext);
  if (!c) throw new Error("useCatalogue must be used inside <CatalogueProvider>");
  return c;
}
