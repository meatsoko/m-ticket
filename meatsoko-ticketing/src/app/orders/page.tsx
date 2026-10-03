import { requireStaff } from "@/lib/require-staff";
import AppShell from "@/components/AppShell";
import OrdersHome from "@/components/orders/OrdersHome";
import { orderEvents, staffNames } from "@/lib/event-orders-server";
import { ORDER_COLUMNS, type EventOrder } from "@/lib/event-orders";

export const dynamic = "force-dynamic";

// Event Orders, staff phone home: new order, search, and the event's orders.
export default async function OrdersPage({ searchParams }: { searchParams: { event?: string } }) {
  const { supabase, user, role } = await requireStaff();
  const events = await orderEvents(supabase);
  const event = events.find((e) => e.id === searchParams.event) ?? events[0];

  if (!event) {
    return (
      <AppShell title="Orders" role={role}>
        <div className="pad"><div className="empty"><h2>No event is taking orders</h2>
          <p className="small">An admin adds the on-site menu in the dashboard (Events &amp; tickets → Event orders → Menu).</p></div></div>
      </AppShell>
    );
  }
  const [{ data: orders }, names] = await Promise.all([
    supabase.from("event_orders").select(`${ORDER_COLUMNS},event_order_payments(reference)`).eq("event_id", event.id)
      .order("seq", { ascending: false }).limit(1000),
    staffNames(supabase),
  ]);
  return (
    <AppShell title="Orders" role={role}>
      <div className="pad">
        <OrdersHome event={event} events={events} orders={(orders ?? []) as unknown as EventOrder[]} me={user.id} names={names} />
        <div className="bottom-gap" />
      </div>
    </AppShell>
  );
}
