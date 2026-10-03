import { createClient } from "@/lib/supabase/server";
import EventOrdersBoard from "@/components/dashboard/EventOrdersBoard";
import { ORDER_COLUMNS, PAYMENT_COLUMNS, type EventOrder, type MenuItem } from "@/lib/event-orders";

export const dynamic = "force-dynamic";

// Event Orders for management (migration 20261003100000). Admin session: RLS
// "staff read" for orders/payments; menu edits need admin; cancel / refund /
// correct go through admin-only database functions.
export default async function EventOrdersPage({ searchParams }: { searchParams: { event?: string } }) {
  const supabase = createClient();
  const { data: events } = await supabase.from("events").select("id,name,slug,status,starts_at")
    .neq("status", "draft").order("starts_at", { ascending: false });
  const list = (events ?? []) as { id: string; name: string; slug: string; status: string; starts_at: string }[];
  // Default: the soonest live event that hasn't happened yet, else the latest.
  const upcoming = list.filter((e) => e.status === "live").sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const event = list.find((e) => e.id === searchParams.event) ?? upcoming[0] ?? list[0];
  if (!event) return <p className="dash-empty">No events yet.</p>;

  await supabase.rpc("release_stale_event_order_requests", { p_event_id: event.id });
  const [orders, menu, staff, roster] = await Promise.all([
    supabase.from("event_orders")
      .select(`${ORDER_COLUMNS},event_order_items(name,qty,unit_price_kes,line_total_kes),event_order_payments(${PAYMENT_COLUMNS})`)
      .eq("event_id", event.id).order("seq", { ascending: false }).limit(5000),
    supabase.from("event_menu_items").select("id,event_id,name,description,price_kes,is_active,position").eq("event_id", event.id).order("position").order("name"),
    supabase.rpc("staff_directory"),
    supabase.from("event_staff").select("user_id,display_name,status,updated_at").eq("event_id", event.id).order("display_name"),
  ]);
  if (orders.error) return <p className="dash-error">Couldn&apos;t load orders: {orders.error.message}</p>;
  return (
    <EventOrdersBoard
      events={list.map(({ id, name, status }) => ({ id, name, status }))}
      event={{ id: event.id, name: event.name }}
      orders={(orders.data ?? []) as unknown as EventOrder[]}
      menu={(menu.data ?? []) as MenuItem[]}
      staff={(staff.data ?? []) as { user_id: string; email: string; role: string }[]}
      roster={(roster.data ?? []) as { user_id: string; display_name: string; status: "available" | "busy" | "offline"; updated_at: string }[]}
    />
  );
}
