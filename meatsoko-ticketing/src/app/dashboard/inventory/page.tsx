import { createClient } from "@/lib/supabase/server";
import InventoryBoard, { type DashGroup } from "@/components/dashboard/InventoryBoard";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const supabase = createClient();
  const { data, error } = await supabase.from("merch_groups")
    .select(`id,name,position,
             merch_products(id,name,color,slug,price_usd,position,is_active,
               merch_variants(id,size,sku,stock_on_hand,low_stock_at,position,is_active))`)
    .order("position");
  if (error) return <p className="dash-error">Couldn&apos;t load inventory: {error.message}</p>;
  return <InventoryBoard groups={(data ?? []) as unknown as DashGroup[]} />;
}
