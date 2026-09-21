import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EventDashboard from "@/components/EventDashboard";

export default async function AdminEventPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: ev } = await supabase.from("events").select("*").eq("id", params.id).maybeSingle();
  if (!ev) notFound();

  const { data: types } = await supabase.from("ticket_types").select("*")
    .eq("event_id", ev.id).order("position");

  const { data: orders } = await supabase.from("orders")
    .select("id,status,channel,amount_kes,buyer_phone,created_at")
    .eq("event_id", ev.id);

  const { data: tickets } = await supabase.from("tickets")
    .select("id,status,qr_token,order_id,ticket_type_id,redeemed_at")
    .in("order_id", (orders ?? []).map((o: any) => o.id).concat(["00000000-0000-0000-0000-000000000000"]));

  return (
    <EventDashboard
      event={ev}
      types={types ?? []}
      orders={orders ?? []}
      tickets={tickets ?? []}
    />
  );
}
