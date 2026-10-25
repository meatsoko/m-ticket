import { createClient } from "@/lib/supabase/server";
import SalesBoard, { type ManualSale } from "@/components/dashboard/sales/SalesBoard";
import { loadInvGroups } from "@/lib/inventory-server";

export const dynamic = "force-dynamic";

// Dashboard → Sales: one report over website orders, manual sales and returns
// (merch_report / merch_sales_lines), and where admins record sales made outside
// the website. Read with the admin's session; every write is a checked function.
export default async function SalesPage() {
  const supabase = createClient();
  const [groups, fx, events, sales, staff] = await Promise.all([
    loadInvGroups(supabase),
    supabase.rpc("merch_current_fx"),
    supabase.from("events").select("id,name,starts_at").order("starts_at", { ascending: false }).limit(20),
    supabase.from("merch_manual_sales")
      .select(`id,sale_number,sold_at,payment_method,mpesa_code,payment_ref,buyer_name,location,event_id,note,subtotal_kes,refunded_kes,
               status,void_reason,voided_at,replaces_sale_id,created_by,created_at,
               merch_manual_sale_items(id,variant_id,product_name,color,size,sku,qty,unit_price_kes,line_total_kes,stock_tracked),
               merch_returns(id,return_number,created_at,reason,refund_kes,refund_method,extra_paid_kes,
                 merch_return_lines(direction,manual_sale_item_id,product_name,color,size,qty,refund_kes,stock_moved))`)
      .order("sold_at", { ascending: false })
      .limit(200),
    supabase.rpc("staff_directory"),
  ]);
  if (sales.error) return <p className="dash-error">Couldn&apos;t load sales: {sales.error.message}</p>;
  const rate = ((fx.data ?? []) as any[])[0]?.rate;
  return (
    <SalesBoard
      groups={groups}
      fxRate={rate != null ? Number(rate) : null}
      events={(events.data ?? []) as { id: string; name: string; starts_at: string }[]}
      sales={(sales.data ?? []) as unknown as ManualSale[]}
      people={Object.fromEntries(((staff.data ?? []) as any[]).map((s) => [s.user_id, s.email]))}
    />
  );
}
