"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function EventManager({ events }: { events: any[] }) {
  const supabase = createClient();
  const router = useRouter();
  const [name, setName] = useState("");
  const [venue, setVenue] = useState("");
  const [starts, setStarts] = useState("");
  const [busy, setBusy] = useState(false);

  async function createEvent() {
    setBusy(true);
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + Date.now().toString(36);
    const { data, error } = await supabase.from("events").insert({
      name, slug, venue, starts_at: new Date(starts).toISOString(),
      ends_at: new Date(starts).toISOString(), status: "draft",
    }).select().single();
    setBusy(false);
    if (!error && data) router.push(`/admin/events/${data.id}`);
  }

  return (
    <div>
      <h1>Events</h1>
      {events.map((ev: any) => (
        <a key={ev.id} className="card" href={`/admin/events/${ev.id}`} style={{ display: "block", color: "inherit", textDecoration: "none" }}>
          <div className="row">
            <strong>{ev.name}</strong>
            <span className={`pill ${ev.status === "live" ? "ok" : ""}`}>{ev.status}</span>
          </div>
          <p className="small">{new Date(ev.starts_at).toLocaleString()} — {ev.venue}</p>
        </a>
      ))}
      <div className="card">
        <h3>New event</h3>
        <input placeholder="Event name" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="Venue" value={venue} onChange={(e) => setVenue(e.target.value)} />
        <input type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} />
        <button onClick={createEvent} disabled={busy || !name || !starts} style={{ width: "100%" }}>Create draft</button>
      </div>
    </div>
  );
}
