import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/require-staff";
import AppShell from "@/components/AppShell";
import OrderDetail from "@/components/orders/OrderDetail";
import { staffNames } from "@/lib/event-orders-server";
import { ORDER_COLUMNS, PAYMENT_COLUMNS, type EventOrder } from "@/lib/event-orders";

export const dynamic = "force-dynamic";

export default async function OrderPage({ params }: { params: { id: string } }) {
  const { supabase, user, role } = await requireStaff();
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound();
  const [{ data: order }, names] = await Promise.all([
    supabase.from("event_orders")
      .select(`${ORDER_COLUMNS},event_order_items(name,qty,unit_price_kes,line_total_kes),event_order_payments(${PAYMENT_COLUMNS}),events(name)`)
      .eq("id", params.id).order("recorded_at", { referencedTable: "event_order_payments" }).maybeSingle(),
    staffNames(supabase),
  ]);
  if (!order) notFound();
  const o = order as unknown as EventOrder & { events: { name: string } | null };
  return (
    <AppShell title={o.order_number} back={`/orders?event=${o.event_id}`} role={role}>
      <div className="pad">
        <OrderDetail order={o} eventName={o.events?.name ?? ""} me={user.id} isAdmin={role === "admin"} names={names} />
        <div className="bottom-gap" />
      </div>
    </AppShell>
  );
}
