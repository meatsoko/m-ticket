import Link from "next/link";
import AppShell from "@/components/AppShell";
import Icon from "@/components/Icon";
import { createClient } from "@/lib/supabase/server";
import EventTicket from "@/components/EventTicket";
import { toTicketEvent } from "@/lib/ticket-event";

const KE = "Africa/Nairobi";
const fmt = (iso: string, o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-KE", { timeZone: KE, ...o }).format(new Date(iso));

type Phase = "past" | "now" | "soon";

/**
 * The line-up. Exactly one event is open at a time: it is shown as the same
 * ticket card as the homepage hero, and it is the only one that is a link.
 * Everything else is context — announced ("Coming soon") or past.
 */
export default async function EventsPage() {
  const supabase = createClient();
  const { data: events } = await supabase
    .from("events").select("*").neq("status", "draft").order("starts_at");

  const list = events ?? [];

  const phaseOf = (e: any): Phase => {
    if (e.status === "closed") return "past";
    // An event whose day has passed is history even if nobody closed it.
    if (new Date(e.ends_at ?? e.starts_at).getTime() < Date.now()) return "past";
    // "Coming soon" is an announced event whose reservation window has not
    // opened yet — the same rule create_reservation() enforces server-side.
    const opens = e.reservations_open_at ? new Date(e.reservations_open_at).getTime() : null;
    if (opens !== null && opens > Date.now()) return "soon";
    if (e.reservations_close_at && new Date(e.reservations_close_at).getTime() < Date.now()) return "past";
    return "now";
  };

  // General Admission events say "Free entry · tables available" on the ticket.
  const openIds = list.filter((e: any) => phaseOf(e) === "now").map((e: any) => e.id);
  const { data: ga } = openIds.length
    ? await supabase.from("reservation_types").select("event_id").in("event_id", openIds).eq("is_general_admission", true).eq("is_active", true)
    : { data: [] as { event_id: string }[] };
  const hasGa = new Set((ga ?? []).map((r) => r.event_id));

  // Announced and past events. Only the open event (the ticket) is actionable —
  // a closed or announced event that looks tappable is a dead end.
  const card = (e: any) => {
    const phase = phaseOf(e);
    // An announced event whose registration only opens on the day (or never
    // before it) has no date to promise: say so instead of a fake one.
    const noRegistrationYet = !e.reservations_open_at || new Date(e.reservations_open_at) >= new Date(e.starts_at);
    return (
      <div key={e.id} className={`ev-card ${phase}`} aria-disabled="true">
        <div className="row">
          <span className="ev-date" aria-hidden="true">
            <span className="d num">{fmt(e.starts_at, { day: "numeric" })}</span>
            <span className="m">{fmt(e.starts_at, { month: "short" })}</span>
          </span>
          <div className="stack tight" style={{ flex: 1, minWidth: 0 }}>
            <strong>{e.name}</strong>
            <span className="small">
              {fmt(e.starts_at, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
              {e.venue ? ` · ${e.venue}` : ""}
            </span>
          </div>
          {e.banner_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="ev-thumb" src={e.banner_url} alt="" loading="lazy" />
          )}
        </div>
        {e.tagline && <span className="small">{e.tagline}</span>}
        <div className="row ev-card-foot">
          <span className={`pill ${phase === "soon" ? "warn" : ""}`}>{phase === "soon" ? "Coming soon" : "Closed"}</span>
          {phase === "soon" && (
            <span className="small">
              {noRegistrationYet ? "Registration details coming soon."
                : `Reservations open ${fmt(e.reservations_open_at, { day: "numeric", month: "long" })}.`}
            </span>
          )}
        </div>
      </div>
    );
  };
  const open = list.filter((e: any) => phaseOf(e) === "now");
  const soon = list.filter((e: any) => phaseOf(e) === "soon");
  const past = list.filter((e: any) => phaseOf(e) === "past").reverse();

  return (
    <AppShell title="Events" wideEvent>
      <div className="pad">
        <div className="stack tight event-lineup-heading">
          <span className="eyebrow">MeatSoko</span>
          <h1>The line-up</h1>
        </div>

        {list.length === 0 && (
          <div className="empty">
            <Icon name="ticket" size={30} />
            <strong>Nothing announced yet</strong>
          </div>
        )}

        <div className="lineup-top">
        {open.length > 0 && (
          <section className="lineup-section" aria-label="Up next">
            <h2 className="lineup-label">Up next</h2>
            <div className="lineup-open">
              {open.map((e: any) => (
                <Link key={e.id} href={`/e/${e.slug}`} className="lineup-ticket" aria-label={`${e.name} — get tickets`}>
                  <span className="lineup-ticket-box"><EventTicket event={toTicketEvent(e, hasGa.has(e.id))} /></span>
                </Link>
              ))}
            </div>
          </section>
        )}
        {soon.length > 0 && (
          <section className="lineup-section" aria-label="Coming soon">
            <h2 className="lineup-label">Coming soon</h2>
            <div className="lineup-soon">{soon.map(card)}</div>
          </section>
        )}
        </div>
        {past.length > 0 && (
          <section className="lineup-section" aria-label="Past events">
            <h2 className="lineup-label">Past events</h2>
            <div className="event-lineup-grid">{past.map(card)}</div>
          </section>
        )}

        <div className="bottom-gap" />
      </div>
    </AppShell>
  );
}
