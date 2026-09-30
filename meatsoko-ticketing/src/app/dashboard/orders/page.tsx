import { createClient } from "@/lib/supabase/server";
import OrdersBoard, { type DashOrder } from "@/components/dashboard/OrdersBoard";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const supabase = createClient();
  const { data, error } = await supabase.from("merch_orders")
    .select(`id,order_number,created_at,paid_at,first_name,last_name,phone,email,delivery_code,delivery_address,
             delivery_town,delivery_sacco,notes,total_usd,total_kes,payment_status,fulfilment_status,refund_reason,
             merch_delivery_options(label),merch_delivery_zones(name),
             merch_order_items(product_name,color,size,qty,unit_price_usd)`)
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) return <p className="dash-error">Couldn&apos;t load orders: {error.message}</p>;
  return <OrdersBoard orders={(data ?? []) as unknown as DashOrder[]} />;
}
