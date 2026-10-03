import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/require-staff";
import AppShell from "@/components/AppShell";
import NewOrderFlow from "@/components/orders/NewOrderFlow";
import { orderEvents, staffNames } from "@/lib/event-orders-server";
import type { MenuItem } from "@/lib/event-orders";

export const dynamic = "force-dynamic";

export default async function NewOrderPage({ searchParams }: { searchParams: { event?: string } }) {
  const { supabase, user, role } = await requireStaff();
  const events = await orderEvents(supabase);
  const event = events.find((e) => e.id === searchParams.event) ?? events[0];
  if (!event) redirect("/orders");
  const [{ data: menu }, names] = await Promise.all([
    supabase.from("event_menu_items").select("id,event_id,name,description,price_kes,is_active,position")
      .eq("event_id", event.id).eq("is_active", true).order("position").order("name"),
    staffNames(supabase),
  ]);
  return (
    <AppShell title="New order" back={`/orders?event=${event.id}`} role={role} hideTabs>
      <div className="pad">
        <NewOrderFlow event={{ id: event.id, name: event.name }} menu={(menu ?? []) as MenuItem[]} me={user.id} names={names} />
      </div>
    </AppShell>
  );
}
