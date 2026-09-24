import { requireStaff } from "@/lib/require-staff";
import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/AppShell";
import Scanner from "@/components/Scanner";
import ScanTabs from "@/components/ScanTabs";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";

export default async function ScanPage() {
  const { user, role } = await requireStaff();
  const supabase = createClient();

  // The door list only means anything for an event that takes reservations. A
  // ticketed event falls through to the scanner alone, exactly as before.
  const { data: event } = await supabase.from("events")
    .select("id,reservation_mode").eq("status", "live").neq("reservation_mode", "off")
    .order("starts_at", { ascending: false }).limit(1).maybeSingle();

  // Same two queries the admin event page runs. RLS ("staff read reservations")
  // scopes them to signed-in staff, so no policy or role change is needed.
  const [rows, stats] = event
    ? await Promise.all([
        supabase.from("reservations")
          .select("*,orders(status,amount_kes)")
          .eq("event_id", event.id).order("created_at", { ascending: false })
          .then((r) => r.data ?? []),
        supabase.rpc("expected_attendance", { p_event_id: event.id }).then((r) => r.data),
      ])
    : [[], null];

  return (
    <>
      <ServiceWorkerRegister />
      <AppShell title="Scanner" role={role}>
        <div className="pad">
          {event ? (
            <ScanTabs userId={user.id} eventId={event.id} reservations={rows} stats={stats} />
          ) : (
            <Scanner userId={user.id} />
          )}
          <div className="bottom-gap" />
        </div>
      </AppShell>
    </>
  );
}
