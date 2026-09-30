import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const fmt = (iso: string) => new Intl.DateTimeFormat("en-KE", { timeZone: "Africa/Nairobi", weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
const STATUS: Record<string, string> = { live: "Live", draft: "Draft", closed: "Closed" };

export default async function DashboardEventsPage() {
  const supabase = createClient();
  const [{ data: events }, { data: res }] = await Promise.all([
    supabase.from("events").select("id,name,slug,venue,starts_at,status,capacity,reservation_mode").order("starts_at", { ascending: false }),
    supabase.from("reservations").select("event_id,party_size,status").neq("status", "cancelled"),
  ]);
  const byEvent = new Map<string, { bookings: number; people: number; inside: number }>();
  for (const r of (res ?? []) as any[]) {
    const x = byEvent.get(r.event_id) ?? { bookings: 0, people: 0, inside: 0 };
    x.bookings += 1; x.people += Number(r.party_size ?? 0); if (r.status === "checked_in") x.inside += Number(r.party_size ?? 0);
    byEvent.set(r.event_id, x);
  }
  return (
    <div className="dash-stack">
      <div className="dash-title-row">
        <div className="dash-title"><h1>Events &amp; bookings</h1><p>Every event, its bookings and settings.</p></div>
        <Link href="/dashboard/events/new" className="dash-btn primary">+ New event</Link>
      </div>
      <div className="dash-card">
        <table className="dash-table dash-events-table">
          <thead><tr><th>Event</th><th>Date</th><th>Status</th><th>Bookings</th><th>Guests</th><th>Capacity</th><th /></tr></thead>
          <tbody>
            {(events ?? []).map((e: any) => {
              const s = byEvent.get(e.id) ?? { bookings: 0, people: 0, inside: 0 };
              const pct = e.capacity ? Math.min(100, (s.people / e.capacity) * 100) : null;
              return (
                <tr key={e.id}>
                  <td><Link href={`/dashboard/events/${e.id}`} className="dash-row-link"><strong>{e.name}</strong><small>{e.venue || "—"}</small></Link></td>
                  <td>{fmt(e.starts_at)}</td>
                  <td><span className={`dash-badge ev-${e.status}`}>{STATUS[e.status] ?? e.status}</span></td>
                  <td>{s.bookings}</td>
                  <td>{s.people}{s.inside ? <small>{s.inside} in</small> : null}</td>
                  <td>{e.capacity ? (
                    <div className="dash-cap"><span>{s.people} / {e.capacity}</span><i><b style={{ width: `${pct}%` }} /></i></div>
                  ) : "—"}</td>
                  <td><Link href={`/dashboard/events/${e.id}`} className="dash-link">Open →</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!(events ?? []).length && <div className="dash-empty">No events yet.</div>}
      </div>
    </div>
  );
}
