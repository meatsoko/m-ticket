import { createClient } from "@/lib/supabase/server";
import InventoryBoard, { type Batch, type Movement } from "@/components/dashboard/InventoryBoard";
import type { InvGroup } from "@/lib/inventory";

export const dynamic = "force-dynamic";

// Everything the Inventory page shows, read with the admin's session (RLS: admins
// read batches; staff read movements; merch_availability gives the live web holds).
export default async function InventoryPage() {
  const supabase = createClient();
  const [cat, avail, committed, batches, movements, staff, check] = await Promise.all([
    supabase.from("merch_groups")
      .select(`id,name,position,
               merch_products(id,name,color,slug,price_usd,position,is_active,sold_out,stock_product_id,
                 merch_variants(id,size,sku,stock_on_hand,low_stock_at,position,is_active,is_bucket))`)
      .order("position"),
    supabase.rpc("merch_availability"),
    // Paid website orders not handed over yet: units that may sit packed on a shelf.
    supabase.from("merch_order_items")
      .select("variant_id,qty,merch_orders!inner(payment_status,fulfilment_status)")
      .eq("merch_orders.payment_status", "paid")
      .in("merch_orders.fulfilment_status", ["unfulfilled", "packed", "ready_for_pickup"]),
    supabase.from("merch_stock_batches")
      .select(`id,batch_number,kind,status,supplier,reference,issue_reason,note,reverses_batch_id,created_by,created_at,confirmed_by,confirmed_at,
               merch_stock_batch_lines(variant_id,counted,qty,expected_on_hand,unit_cost_kes,outcome,delta)`)
      .order("created_at", { ascending: false })
      .limit(150),
    supabase.from("merch_stock_movements")
      .select(`id,variant_id,delta,reason,balance,note,actor,created_at,
               merch_stock_batches(batch_number),merch_manual_sales(sale_number),merch_returns(return_number),merch_orders(order_number)`)
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase.rpc("staff_directory"),
    supabase.rpc("merch_stock_check"),
  ]);
  const error = cat.error ?? batches.error ?? movements.error;
  if (error) return <p className="dash-error">Couldn&apos;t load inventory: {error.message}</p>;

  const held = new Map<string, number>(((avail.data ?? []) as any[]).map((r) => [r.variant_id, Number(r.held ?? 0)]));
  const owed = new Map<string, number>();
  for (const r of (committed.data ?? []) as any[]) owed.set(r.variant_id, (owed.get(r.variant_id) ?? 0) + r.qty);

  const groups: InvGroup[] = ((cat.data ?? []) as any[]).map((g) => ({
    id: g.id, name: g.name, position: g.position,
    products: [...(g.merch_products ?? [])].sort((a: any, b: any) => a.position - b.position).map((p: any) => ({
      id: p.id, name: p.name, color: p.color, slug: p.slug, position: p.position,
      price_usd: p.price_usd == null ? null : Number(p.price_usd), is_active: p.is_active, sold_out: p.sold_out, stock_product_id: p.stock_product_id,
      variants: [...(p.merch_variants ?? [])].sort((a: any, b: any) => a.position - b.position).map((v: any) => ({
        ...v, held: held.get(v.id) ?? 0, committed: owed.get(v.id) ?? 0,
      })),
    })),
  }));
  const people = Object.fromEntries(((staff.data ?? []) as any[]).map((s) => [s.user_id, s.email]));

  return (
    <InventoryBoard
      groups={groups}
      batches={(batches.data ?? []) as unknown as Batch[]}
      movements={(movements.data ?? []) as unknown as Movement[]}
      people={people}
      ledgerProblems={check.error ? null : ((check.data ?? []) as any[]).length}
    />
  );
}
