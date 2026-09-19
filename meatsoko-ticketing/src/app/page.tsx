import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = createClient();
  const { data: events } = await supabase
    .from("events").select("*").eq("status", "live").order("starts_at");

  if (!events || events.length === 0)
    return <div className="container"><h1>No upcoming events</h1></div>;
  if (events.length === 1) redirect(`/e/${events[0].slug}`);

  return (
    <div className="container">
      <h1>MeatSoko Events</h1>
      {events.map((ev: any) => (
        <a key={ev.id} className="card" href={`/e/${ev.slug}`} style={{ display: "block", color: "inherit", textDecoration: "none" }}>
          <h2>{ev.name}</h2>
          <p className="small">{new Date(ev.starts_at).toLocaleString()} — {ev.venue}</p>
        </a>
      ))}
    </div>
  );
}
