"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Creates a draft event (same insert as the mobile EventManager); it stays
// hidden from the public until it is set live in its settings.
export default function NewEventForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [venue, setVenue] = useState("");
  const [starts, setStarts] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function create() {
    if (!name.trim() || !starts) { setErr("Name and start date are required."); return; }
    setBusy(true); setErr("");
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + Date.now().toString(36);
    const at = new Date(starts).toISOString();
    const { data, error } = await createClient().from("events").insert({
      name: name.trim(), slug, venue: venue.trim(), starts_at: at, ends_at: at, status: "draft",
    }).select("id").single();
    setBusy(false);
    if (error || !data) { setErr(error?.message ?? "Could not create the event."); return; }
    router.push(`/dashboard/events/${data.id}`);
  }

  if (!open) return <button type="button" className="dash-btn primary" onClick={() => setOpen(true)}>+ New event</button>;
  return (
    <div className="dash-new-event">
      <input placeholder="Event name" value={name} onChange={(e) => setName(e.target.value)} />
      <input placeholder="Venue" value={venue} onChange={(e) => setVenue(e.target.value)} />
      <input type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} aria-label="Starts" />
      <button type="button" className="dash-btn primary" disabled={busy} onClick={create}>{busy ? "Creating…" : "Create draft"}</button>
      <button type="button" className="dash-btn ghost" onClick={() => setOpen(false)}>Cancel</button>
      {err && <small className="dash-error">{err}</small>}
    </div>
  );
}
