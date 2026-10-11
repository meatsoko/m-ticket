import Link from "next/link";
import AppShell from "@/components/AppShell";
import Icon from "@/components/Icon";
import { createClient } from "@/lib/supabase/server";

const KE = "Africa/Nairobi";
const fmt = (iso: string, o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-KE", { timeZone: KE, ...o }).format(new Date(iso));

type Phase = "past" | "now" | "soon";

/**
 * The line-up. Exactly one event is open at a time, and it is the only card
 * that is a link and the only one that animates — everything else is context.
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

  return (
    <AppShell title="Events">
      <div className="pad">
        <div className="stack tight">
          <span className="eyebrow">MeatSoko</span>
          <h1>The line-up</h1>
        </div>

        {list.length === 0 && (
          <div className="empty">
            <Icon name="ticket" size={30} />
            <strong>Nothing announced yet</strong>
          </div>
        )}

        {list.map((e: any) => {
          const phase = phaseOf(e);
          const inner = (
            <>
              <div className="row">
                <span className="ev-date" aria-hidden="true">
                  <span className="d num">{fmt(e.starts_at, { day: "numeric" })}</span>
                  <span className="m">{fmt(e.starts_at, { month: "short" })}</span>
                </span>
                <div className="stack tight" style={{ flex: 1, minWidth: 0 }}>
                  <strong>{e.name}</strong>
                  <span className="small">
                    {fmt(e.starts_at, { weekday: "long" })}
                    {e.venue ? ` · ${e.venue}` : ""}
                  </span>
                </div>
                <span className={`pill ${phase === "now" ? "ember" : phase === "soon" ? "warn" : ""}`}>
                  {phase === "now" ? "Open" : phase === "soon" ? "Coming soon" : "Closed"}
                </span>
              </div>
              {e.tagline && <span className="small">{e.tagline}</span>}
              {phase === "now" && (
                <span className="small" style={{ color: "var(--ember)", fontWeight: 600 }}>
                  Reserve your place →
                </span>
              )}
              {phase === "soon" && (
                <span className="small">
                  Reservations open{e.reservations_open_at
                    ? ` ${fmt(e.reservations_open_at, { day: "numeric", month: "long" })}`
                    : " closer to the date"}.
                </span>
              )}
            </>
          );

          // Only the open event is actionable — a closed or unannounced event
          // that looks tappable is a dead end.
          return phase === "now" ? (
            <Link key={e.id} href={`/e/${e.slug}`} className="ev-card now">{inner}</Link>
          ) : (
            <div key={e.id} className={`ev-card ${phase}`} aria-disabled="true">{inner}</div>
          );
        })}

        <div className="bottom-gap" />
      </div>
    </AppShell>
  );
}
