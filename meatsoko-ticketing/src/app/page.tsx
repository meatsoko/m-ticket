import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

const KE = "Africa/Nairobi";

/**
 * Poster-first landing. One image, the event's name, and a single bouncing
 * call to action — nothing else competes with it. The featured event is the
 * open one if there is one, otherwise the next upcoming.
 */
export default async function Home() {
  const supabase = createClient();
  const { data: events } = await supabase
    .from("events").select("*").neq("status", "draft").order("starts_at");

  const now = Date.now();
  const list = events ?? [];
  // Feature whatever a visitor can act on right now: a live event whose
  // reservation window is open. Otherwise the next announced one.
  const isOpen = (e: any) =>
    e.status === "live" &&
    new Date(e.ends_at ?? e.starts_at).getTime() >= now &&
    (!e.reservations_open_at || new Date(e.reservations_open_at).getTime() <= now) &&
    (!e.reservations_close_at || new Date(e.reservations_close_at).getTime() >= now);

  const featured =
    list.find(isOpen) ??
    list.find((e: any) => e.status === "live" && new Date(e.starts_at).getTime() >= now) ??
    list[list.length - 1];

  return (
    <div className="app">
      <main className="app-body" style={{ display: "flex", flexDirection: "column" }}>
        <section className="poster">
          {featured?.banner_url
            ? <img src={featured.banner_url} alt="" />
            : <div className="poster-fallback" aria-hidden="true" />}

          <span className="kicker">{featured?.tagline ?? "MeatSoko presents"}</span>
          <h1>{featured?.name ?? "MeatSoko"}</h1>
          {featured && (
            <p className="sub">
              {new Intl.DateTimeFormat("en-KE", {
                timeZone: KE, weekday: "long", day: "numeric", month: "long",
              }).format(new Date(featured.starts_at))}
              {featured.venue ? ` · ${featured.venue}` : ""}
            </p>
          )}

          <Link href="/events" className="btn btn-primary btn-block cta-bounce"
            style={{ marginTop: "var(--s4)" }}>
            See the line-up
          </Link>
          <p className="small" style={{ color: "rgba(255,255,255,.7)" }}>
            Reserve your place — free
          </p>
        </section>
      </main>
    </div>
  );
}
