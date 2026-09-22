import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/AppShell";
import Icon from "@/components/Icon";

export default async function Home() {
  const supabase = createClient();
  const { data: events } = await supabase
    .from("events").select("*").eq("status", "live").order("starts_at");

  if (!events || events.length === 0) {
    return (
      <AppShell>
        <div className="empty">
          <Icon name="ticket" size={30} />
          <strong>No events on sale</strong>
          <p className="small">Check back soon.</p>
        </div>
      </AppShell>
    );
  }
  // One live event is the v1 norm — send buyers straight to it.
  if (events.length === 1) redirect(`/e/${events[0].slug}`);

  return (
    <AppShell>
      <div className="pad">
        <h1>Upcoming</h1>
        {events.map((ev: any) => (
          <a key={ev.id} className="card" href={`/e/${ev.slug}`} style={{ textDecoration: "none", color: "inherit" }}>
            <div className="row">
              <div className="stack tight">
                <strong>{ev.name}</strong>
                <span className="small">
                  {new Intl.DateTimeFormat("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "medium" }).format(new Date(ev.starts_at))} · {ev.venue}
                </span>
              </div>
              <span className="pill ember">Tickets</span>
            </div>
          </a>
        ))}
        <div className="bottom-gap" />
      </div>
    </AppShell>
  );
}
