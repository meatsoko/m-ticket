import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EventCheckout from "@/components/EventCheckout";
import type { Event, TicketType } from "@/lib/types";

export default async function EventPage({ params }: { params: { slug: string } }) {
  const supabase = createClient();
  const { data: ev } = await supabase.from("events").select("*")
    .eq("slug", params.slug).eq("status", "live").maybeSingle();
  if (!ev) notFound();

  const { data: types } = await supabase.from("ticket_types").select("*")
    .eq("event_id", ev.id).eq("is_active", true).order("position");

  return (
    <div className="container">
      <h1>{ev.name}</h1>
      <p className="small">
        {new Date(ev.starts_at).toLocaleString()} — {ev.venue}
      </p>
      {ev.description && <p>{ev.description}</p>}
      <EventCheckout event={ev as Event} types={(types ?? []) as TicketType[]} />
      <p className="small"><a href="/lookup">Already bought? Find your tickets</a></p>
    </div>
  );
}
