// Products and sizes with live stock, for the dashboard's Sales and Orders pages
// (the sale and exchange pickers). Read with the admin's session.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InvGroup } from "./inventory";

export async function loadInvGroups(supabase: SupabaseClient): Promise<InvGroup[]> {
  const [cat, avail] = await Promise.all([
    supabase.from("merch_groups")
      .select(`id,name,position,
               merch_products(id,name,color,slug,price_usd,position,is_active,sold_out,
                 merch_variants(id,size,sku,stock_on_hand,low_stock_at,position,is_active))`)
      .order("position"),
    supabase.rpc("merch_availability"),
  ]);
  const held = new Map<string, number>(((avail.data ?? []) as any[]).map((r) => [r.variant_id, Number(r.held ?? 0)]));
  return ((cat.data ?? []) as any[]).map((g) => ({
    id: g.id, name: g.name, position: g.position,
    products: [...(g.merch_products ?? [])].sort((a: any, b: any) => a.position - b.position).map((p: any) => ({
      id: p.id, name: p.name, color: p.color, slug: p.slug, position: p.position,
      price_usd: p.price_usd == null ? null : Number(p.price_usd), is_active: p.is_active, sold_out: p.sold_out,
      variants: [...(p.merch_variants ?? [])].sort((a: any, b: any) => a.position - b.position)
        .map((v: any) => ({ ...v, held: held.get(v.id) ?? 0, committed: 0 })),
    })),
  }));
}
