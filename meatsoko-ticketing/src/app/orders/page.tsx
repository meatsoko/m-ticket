import { requireStaff } from "@/lib/require-staff";
import AppShell from "@/components/AppShell";
import OrdersHome from "@/components/orders/OrdersHome";
import { orderEvents, staffNames } from "@/lib/event-orders-server";
import { ORDER_COLUMNS, type EventOrder, type StaffStatus } from "@/lib/event-orders";

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
  // Customer requests not accepted within 5 minutes go back to the customer first.
  await supabase.rpc("release_stale_event_order_requests", { p_event_id: event.id });
  const [{ data: orders }, names, { data: mine }] = await Promise.all([
    supabase.from("event_orders").select(`${ORDER_COLUMNS},event_order_items(name,qty),event_order_payments(reference)`).eq("event_id", event.id)
      .order("seq", { ascending: false }).limit(1000),
    staffNames(supabase),
    supabase.from("event_staff").select("display_name,status").eq("event_id", event.id).eq("user_id", user.id).maybeSingle(),
  ]);
  return (
    <AppShell title="Orders" role={role}>
      <div className="pad">
        <OrdersHome event={event} events={events} orders={(orders ?? []) as unknown as EventOrder[]} me={user.id} names={names}
          myStatus={(mine as { display_name: string; status: StaffStatus } | null) ?? null} suggestedName={names[user.id] ?? ""} />
        <div className="bottom-gap" />
      </div>
    </AppShell>
  );
}
