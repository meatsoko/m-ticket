import { requireStaff } from "@/lib/require-staff";
import { createClient } from "@/lib/supabase/server";
import GateMode from "@/components/GateMode";

export default async function GatePage() {
  const {} = await requireStaff();
  const supabase = createClient();
  const { data: event } = await supabase.from("events")
    .select("*").eq("status", "live").order("starts_at", { ascending: false }).limit(1).maybeSingle();
  if (!event) return <div className="container"><h1>No live event</h1></div>;
  const { data: types } = await supabase.from("ticket_types").select("*")
    .eq("event_id", event.id).eq("is_active", true).order("position");

  return (
    <div className="container">
      <GateMode eventId={event.id} types={types ?? []} />
      <p className="small" style={{ textAlign: "center" }}><a href="/scan">← Back to scanner</a></p>
    </div>
  );
}
