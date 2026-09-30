"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { SUPPORT } from "@/lib/support";

// Full-page "New event" for the dashboard. Creates a DRAFT (hidden from the
// public) with the admin's session — RLS decides it may; nothing new server-side.
// Table packages, platters and going live are done on the event page afterwards.

type Mode = "ga" | "rsvp" | "paid";
const MODES: { id: Mode; title: string; body: string }[] = [
  { id: "ga", title: "Free tickets + paid tables", body: "Guests grab a free General Admission ticket and can upgrade to a table with a platter. The NyamaFest setup." },
  { id: "rsvp", title: "Free RSVP", body: "Guests reserve a free place for themselves and their group. No payments." },
  { id: "paid", title: "Paid tickets", body: "Guests buy ticket types you set up (M-Pesa or card). Scanned at the gate." },
];

const toIso = (local: string) => (local ? new Date(local).toISOString() : null);

export default function CreateEventForm() {
  const router = useRouter();
  const [f, setF] = useState({
    name: "", tagline: "", description: "", banner_url: "",
    venue: "", starts: "", ends: "", doors: "",
    capacity: "", max_party: "10", prefix: "", contact_phone: SUPPORT.display, notify_email: "",
  });
  const [mode, setMode] = useState<Mode>("ga");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const problems = [
    !f.name.trim() && "Give the event a name.",
    !f.venue.trim() && "Add the venue.",
    !f.starts && "Set when it starts.",
    f.ends && f.starts && new Date(f.ends) < new Date(f.starts) && "It can't end before it starts.",
    f.capacity && (!/^\d+$/.test(f.capacity) || Number(f.capacity) < 1) && "Capacity must be a whole number.",
  ].filter(Boolean) as string[];

  async function create() {
    if (problems.length) { setErr(problems[0]); return; }
    setBusy(true); setErr("");
    const supabase = createClient();
    const slug = f.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) + "-" + Date.now().toString(36);
    const prefix = (f.prefix.trim() || f.name.replace(/[^A-Za-z]/g, "").slice(0, 3) || "RSV").toUpperCase().slice(0, 5);
    const { data, error } = await supabase.from("events").insert({
      name: f.name.trim(), slug, status: "draft",
      tagline: f.tagline.trim() || null, description: f.description, banner_url: f.banner_url.trim() || null,
      venue: f.venue.trim(), starts_at: toIso(f.starts), ends_at: toIso(f.ends || f.starts), doors_open_at: toIso(f.doors),
      capacity: f.capacity ? Number(f.capacity) : null,
      max_party_size: Number(f.max_party) || 10,
      reservation_mode: mode === "paid" ? "off" : mode === "rsvp" ? "free" : "optional_preorder",
      payments_enabled: mode !== "rsvp",
      reservation_prefix: prefix,
      contact_phone: f.contact_phone.trim() || null,
      notify_email: f.notify_email.trim() || null,
    }).select("id").single();
    if (error || !data) { setBusy(false); setErr(error?.message ?? "Could not create the event."); return; }
    if (mode === "ga") {
      // The free one-person ticket that tables upgrade (migration 20260929180000).
      const { error: gaErr } = await supabase.from("reservation_types").insert({
        event_id: data.id, name: "General Admission", description: "Free entry for one person.",
        fixed_party_size: 1, min_party_size: 1, max_party_size: 1, position: 0, is_active: true, is_general_admission: true,
      });
      if (gaErr) { setBusy(false); setErr(`Event created, but the General Admission ticket wasn't: ${gaErr.message}. Add it on the event page.`); router.push(`/dashboard/events/${data.id}`); return; }
    }
    router.push(`/dashboard/events/${data.id}`);
  }

  return (
    <div className="dash-stack">
      <div className="dash-title-row">
        <div className="dash-title">
          <Link href="/dashboard/events" className="dash-link">← All events</Link>
          <h1>New event</h1>
          <p>Saved as a draft — nobody sees it until you set it live.</p>
        </div>
      </div>

      <div className="dash-create">
        <div className="dash-stack">
          <section className="dash-card dash-form">
            <h2>Event details</h2>
            <label>Event name *<input value={f.name} onChange={set("name")} placeholder="NyamaFest Christmas Edition" /></label>
            <label>Tagline<input value={f.tagline} onChange={set("tagline")} placeholder="Good food, good people, till dawn" /></label>
            <label>Description<textarea rows={5} value={f.description} onChange={set("description")} placeholder="What guests can expect. Tip: “Nyama Choma | Live Grills | Music” shows as highlights." /></label>
            <label>Poster image URL<input value={f.banner_url} onChange={set("banner_url")} placeholder="https://…" /></label>
          </section>
          <section className="dash-card dash-form">
            <h2>When &amp; where</h2>
            <label>Venue *<input value={f.venue} onChange={set("venue")} placeholder="Thika Greens Golf Course" /></label>
            <div className="dash-form-row">
              <label>Starts *<input type="datetime-local" value={f.starts} onChange={set("starts")} /></label>
              <label>Ends<input type="datetime-local" value={f.ends} onChange={set("ends")} /></label>
              <label>Doors open<input type="datetime-local" value={f.doors} onChange={set("doors")} /></label>
            </div>
          </section>
        </div>

        <div className="dash-stack">
          <section className="dash-card dash-form">
            <h2>How guests get in</h2>
            <div className="dash-mode-list" role="radiogroup">
              {MODES.map((m) => (
                <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} className={`dash-mode${mode === m.id ? " on" : ""}`} onClick={() => setMode(m.id)}>
                  <strong>{m.title}</strong><span>{m.body}</span>
                </button>
              ))}
            </div>
            <div className="dash-form-row">
              <label>Capacity<input inputMode="numeric" value={f.capacity} onChange={set("capacity")} placeholder="e.g. 500" /></label>
              {mode === "rsvp" && <label>Max group size<input inputMode="numeric" value={f.max_party} onChange={set("max_party")} /></label>}
              {mode !== "paid" && <label>Booking number prefix<input value={f.prefix} onChange={set("prefix")} placeholder="Auto" maxLength={5} /></label>}
            </div>
          </section>
          <section className="dash-card dash-form">
            <h2>Contact</h2>
            <label>Guest support number<input value={f.contact_phone} onChange={set("contact_phone")} /></label>
            <label>Email me each new booking<input type="email" value={f.notify_email} onChange={set("notify_email")} placeholder="Optional" /></label>
          </section>
          <section className="dash-card dash-create-summary">
            <h2>What happens next</h2>
            <ol>
              <li>The event is created as a <strong>draft</strong>.</li>
              {mode === "ga" && <li>A free <strong>General Admission</strong> ticket is added. Add table packages and platters on the event page.</li>}
              {mode === "paid" && <li>Add your ticket types on the event page.</li>}
              <li>Check the details, then press <strong>Go live</strong> in its settings.</li>
            </ol>
            {err && <p className="dash-error">{err}</p>}
            <button type="button" className="dash-btn primary dash-create-btn" disabled={busy} onClick={create}>{busy ? "Creating…" : "Create draft event"}</button>
          </section>
        </div>
      </div>
    </div>
  );
}
