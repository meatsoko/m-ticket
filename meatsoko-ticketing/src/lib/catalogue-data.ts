// The storefront catalogue, read from Supabase (the single source of truth since
// migration 20261025090000). Public RLS returns only active groups, products and
// sizes, which is exactly what the shop may show. Stock is not part of this: the
// product page asks merch_availability live, and checkout re-checks it.
//
// fetchCatalogue takes any Supabase client (the integration harness passes its
// own); loadCatalogue (src/lib/catalogue.ts) is the cached server entry point.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DeliveryOption, DeliveryZone, MerchandiseCategory, StoreCatalogue } from "./merchandise";

type Row = Record<string, any>;
const num = (v: unknown) => (v == null ? null : Number(v));

export function toCatalogue(groups: Row[], options: Row[], zones: Row[]): StoreCatalogue {
  const categories: MerchandiseCategory[] = [...groups]
    .sort((a, b) => a.position - b.position)
    .map((g) => ({
      id: g.slug,
      name: g.name,
      eyebrow: g.eyebrow ?? "",
      description: g.description ?? "",
      products: [...(g.merch_products ?? [])]
        .sort((a: Row, b: Row) => a.position - b.position)
        .map((p: Row) => ({
          slug: p.slug,
          categoryId: g.slug,
          style: p.style_name,
          name: p.name,
          color: p.color,
          swatch: p.swatch,
          image: p.image_path,
          priceKes: num(p.price_kes),
          compareAtKes: num(p.compare_at_kes),
          sizes: [...(p.merch_variants ?? [])].sort((a: Row, b: Row) => a.position - b.position).map((v: Row) => v.size),
          summary: p.summary ?? "",
          details: p.details ?? [],
          ...(p.partner ? { partner: p.partner } : {}),
          ...(p.sold_out ? { outOfStock: true } : {}),
          ...(p.image_fit === "whole" ? { fit: "whole" as const } : {}),
        }))
        .filter((p) => p.sizes.length > 0),
    }))
    .filter((c) => c.products.length > 0);

  const deliveryOptions: DeliveryOption[] = [...options]
    .sort((a, b) => a.position - b.position)
    .map((o) => ({
      id: o.code, label: o.label, blurb: o.blurb ?? "", feeKes: num(o.fee_kes),
      needsZone: !!o.needs_zone, needsAddress: !!o.needs_address, needsTown: !!o.needs_town,
    }));
  const deliveryZones: DeliveryZone[] = [...zones]
    .sort((a, b) => a.position - b.position)
    .map((z) => ({ name: z.name, feeKes: num(z.fee_kes) }));

  return { categories, delivery: { options: deliveryOptions, zones: deliveryZones } };
}

export async function fetchCatalogue(db: SupabaseClient): Promise<StoreCatalogue> {
  const [groups, options, zones] = await Promise.all([
    db.from("merch_groups").select(`slug,name,eyebrow,description,position,
      merch_products(slug,style_name,name,color,swatch,image_path,price_kes,compare_at_kes,summary,details,partner,sold_out,image_fit,position,
        merch_variants(size,position))`),
    db.from("merch_delivery_options").select("code,label,blurb,fee_kes,needs_zone,needs_address,needs_town,position"),
    db.from("merch_delivery_zones").select("name,fee_kes,position,option_code"),
  ]);
  const error = groups.error ?? options.error ?? zones.error;
  if (error) throw new Error(`catalogue unavailable: ${error.message}`);
  return toCatalogue(groups.data ?? [], options.data ?? [], (zones.data ?? []).filter((z: Row) => z.option_code === "standard"));
}
