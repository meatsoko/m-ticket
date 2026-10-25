import { createClient } from "@/lib/supabase/server";
import OrdersBoard, { type DashOrder } from "@/components/dashboard/OrdersBoard";
import { loadInvGroups } from "@/lib/inventory-server";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const supabase = createClient();
  const [{ data, error }, groups] = await Promise.all([
    supabase.from("merch_orders")
      .select(`id,order_number,created_at,paid_at,first_name,last_name,phone,email,delivery_code,delivery_address,
               delivery_town,delivery_sacco,notes,total_usd,total_kes,delivery_fee_kes,refunded_kes,payment_status,fulfilment_status,refund_reason,
               paystack_reference,
               merch_delivery_options(label),merch_delivery_zones(name),
               merch_order_items(id,product_name,color,size,qty,unit_price_usd,unit_price_kes,line_total_kes),
               merch_returns(id,return_number,created_at,reason,refund_kes,delivery_refund_kes,
                 merch_return_lines(direction,order_item_id,product_name,size,qty,refund_kes))`)
      .order("created_at", { ascending: false })
      .limit(300),
    loadInvGroups(supabase),
  ]);
  if (error) return <p className="dash-error">Couldn&apos;t load orders: {error.message}</p>;
  // The page needs only how it was paid, not the payment reference itself.
  const orders = ((data ?? []) as any[]).map(({ paystack_reference, ...o }) => ({ ...o, paid_with: paystack_reference ? "paystack" : "mpesa" }));
  return <OrdersBoard orders={orders as unknown as DashOrder[]} groups={groups} />;
}
