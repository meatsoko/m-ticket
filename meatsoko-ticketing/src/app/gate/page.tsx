import { requireStaff } from "@/lib/require-staff";
import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/AppShell";
import GateMode from "@/components/GateMode";

export default async function GatePage() {
  const { role } = await requireStaff();
  const supabase = createClient();
  const { data: event } = await supabase.from("events")
    .select("*").eq("status", "live").order("starts_at", { ascending: false }).limit(1).maybeSingle();

  if (!event) {
    return (
      <AppShell title="Gate sales" role={role}>
        <div className="empty"><h2>No live event</h2><p className="small">Ask an admin to take an event live.</p></div>
      </AppShell>
    );
  }

  const { data: types } = await supabase.from("ticket_types").select("*")
    .eq("event_id", event.id).eq("is_active", true).order("position");

  return (
    <AppShell title="Gate sales" role={role}>
      <div className="pad">
        <GateMode eventId={event.id} types={types ?? []} />
        <div className="bottom-gap" />
      </div>
    </AppShell>
  );
}
