import { createClient } from "@/lib/supabase/server";
import EventManager from "@/components/EventManager";

export default async function AdminEventsPage() {
  const supabase = createClient();
  const { data: events } = await supabase.from("events").select("*").order("created_at", { ascending: false });
  return <EventManager events={events ?? []} />;
}
