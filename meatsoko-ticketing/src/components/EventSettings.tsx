"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { ReservationMode } from "@/lib/types";

const KE = "Africa/Nairobi";

/** `timestamptz` -> the `datetime-local` value for that instant in Nairobi. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}

/**
 * Nairobi is UTC+3 year-round with no DST, so a fixed offset is exact here and
 * avoids pulling in a timezone library for one conversion.
 */
const fromLocalInput = (v: string): string | null => (v ? new Date(`${v}:00+03:00`).toISOString() : null);

const MODES: { value: ReservationMode; label: string; hint: string }[] = [
  { value: "off", label: "Ticketed", hint: "Guests buy tickets. The existing checkout." },
  { value: "free", label: "Free RSVP", hint: "Guests reserve a place. No money, no preorders." },
  { value: "optional_preorder", label: "RSVP + optional preorder", hint: "Reserved immediately; preorders may be paid for." },
  { value: "required_preorder", label: "RSVP + required preorder", hint: "Only valid once the preorder is paid." },
];

/**
 * Event configuration. This is the control that decides whether an event sells
 * tickets or takes reservations — without it the reservation feature has no way
 * to be switched on, which is why it also covers the event fields (venue,
 * dates, description, banner) that previously had no edit UI at all (FR-A1).
 */
export default function EventSettings({ event }: { event: any }) {
  const supabase = createClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const [f, setF] = useState({
    name: event.name ?? "",
    tagline: event.tagline ?? "",
    host: event.host ?? "",
    time_note: event.time_note ?? "",
    dress_code: event.dress_code ?? "",
    venue: event.venue ?? "",
    description: event.description ?? "",
    banner_url: event.banner_url ?? "",
    hero_word: event.hero_word ?? "",
    hero_headline: event.hero_headline ?? "",
    hero_image_url: event.hero_image_url ?? "",
    online_enabled: event.online_enabled === true,
    stream_youtube_id: event.stream_youtube_id ?? "",
    starts_at: toLocalInput(event.starts_at),
    ends_at: toLocalInput(event.ends_at),
    doors_open_at: toLocalInput(event.doors_open_at),
    reservation_mode: (event.reservation_mode ?? "off") as ReservationMode,
    payments_enabled: event.payments_enabled !== false,
    reservation_prefix: event.reservation_prefix ?? "RSV",
    capacity: event.capacity ?? "",
    max_party_size: event.max_party_size ?? 10,
    reservations_open_at: toLocalInput(event.reservations_open_at),
    reservations_close_at: toLocalInput(event.reservations_close_at),
    contact_phone: event.contact_phone ?? "",
    contact_email: event.contact_email ?? "",
    notify_email: event.notify_email ?? "",
    notify_whatsapp: event.notify_whatsapp ?? "",
  });

  const set = (k: keyof typeof f, v: any) => setF({ ...f, [k]: v });

  async function save() {
    setBusy(true); setMsg("");
    const { error } = await supabase.from("events").update({
      name: f.name.trim(),
      tagline: f.tagline.trim() || null,
      host: f.host.trim() || null,
      time_note: f.time_note.trim() || null,
      dress_code: f.dress_code.trim() || null,
      venue: f.venue.trim(),
      description: f.description,
      banner_url: f.banner_url.trim() || null,
      hero_word: f.hero_word.trim().toUpperCase() || null,
      hero_headline: f.hero_headline.trim() || null,
      hero_image_url: f.hero_image_url.trim() || null,
      online_enabled: f.online_enabled,
      // Accept a full YouTube URL or the bare ID; store the ID.
      stream_youtube_id: youtubeId(f.stream_youtube_id) || null,
      starts_at: fromLocalInput(f.starts_at),
      ends_at: fromLocalInput(f.ends_at),
      doors_open_at: fromLocalInput(f.doors_open_at),
      reservation_mode: f.reservation_mode,
      payments_enabled: f.payments_enabled,
      reservation_prefix: f.reservation_prefix.toUpperCase().slice(0, 5) || "RSV",
      capacity: f.capacity === "" ? null : Number(f.capacity),
      max_party_size: Number(f.max_party_size) || 10,
      reservations_open_at: fromLocalInput(f.reservations_open_at),
      reservations_close_at: fromLocalInput(f.reservations_close_at),
      contact_phone: f.contact_phone.trim() || null,
      contact_email: f.contact_email.trim() || null,
      notify_email: f.notify_email.trim() || null,
      notify_whatsapp: f.notify_whatsapp.trim() || null,
    }).eq("id", event.id);
    setBusy(false);
    if (error) { setMsg(`Could not save: ${error.message}`); return; }
    setMsg("Saved.");
    router.refresh();
  }

  const isReservation = f.reservation_mode !== "off";

  return (
    <div className="card">
      <button className="btn-ghost" onClick={() => setOpen(!open)} style={{ width: "100%" }}>
        {open ? "Hide settings" : "Event settings"}
      </button>

      {open && (
        <>
          <span className="eyebrow">How this event sells</span>
          <div className="stack tight">
            {MODES.map((m) => (
              <label key={m.value} className="card quiet" style={{ padding: 12, cursor: "pointer", gap: 4 }}>
                <div className="row">
                  <strong style={{ fontSize: ".95rem" }}>{m.label}</strong>
                  <input
                    type="radio" name="reservation_mode" value={m.value}
                    checked={f.reservation_mode === m.value}
                    onChange={() => set("reservation_mode", m.value)}
                    style={{ width: 20, height: 20, margin: 0, flex: "0 0 auto" }}
                  />
                </div>
                <span className="small">{m.hint}</span>
              </label>
            ))}
          </div>

          {isReservation && (
            <>
              <span className="eyebrow">Payments</span>
              <label className="card quiet" style={{ padding: 12, cursor: "pointer", gap: 4 }}>
                <div className="row">
                  <strong style={{ fontSize: ".95rem" }}>Preorders can be paid for</strong>
                  <input type="checkbox" checked={f.payments_enabled}
                    onChange={(e) => set("payments_enabled", e.target.checked)}
                    style={{ width: 20, height: 20, margin: 0, flex: "0 0 auto" }} />
                </div>
                <span className="small">
                  Turn this off while payment providers are being configured. Guests can
                  still reserve free; platters are shown as &ldquo;Coming soon&rdquo; and no
                  payment request is sent.
                </span>
              </label>

              <span className="eyebrow">Online attendance</span>
              <label className="card quiet" style={{ padding: 12, cursor: "pointer", gap: 4 }}>
                <div className="row">
                  <strong style={{ fontSize: ".95rem" }}>Offer free online attendance</strong>
                  <input type="checkbox" checked={f.online_enabled}
                    onChange={(e) => set("online_enabled", e.target.checked)}
                    style={{ width: 20, height: 20, margin: 0, flex: "0 0 auto" }} />
                </div>
                <span className="small">
                  Anyone can register with name, email and country (no phone) and gets a private
                  watch link. Online attendees never count against the venue capacity.
                </span>
              </label>
              <label className="field">
                <span>YouTube Live video ID or link</span>
                <input placeholder="e.g. dQw4w9WgXcQ or https://youtube.com/live/…" value={f.stream_youtube_id}
                  onChange={(e) => set("stream_youtube_id", e.target.value)} />
                <span className="small">Use an unlisted YouTube Live stream. It plays only on attendees&apos; private watch pages, from the event&apos;s start time (a countdown runs until then).</span>
              </label>

              <span className="eyebrow">Reservation rules</span>
              <div className="row" style={{ gap: 8 }}>
                <label className="field" style={{ flex: 1 }}>
                  <span>Capacity (people)</span>
                  <input type="number" inputMode="numeric" placeholder="blank = unlimited"
                    value={f.capacity} onChange={(e) => set("capacity", e.target.value)} />
                </label>
                <label className="field" style={{ flex: 1 }}>
                  <span>Max party size</span>
                  <input type="number" inputMode="numeric"
                    value={f.max_party_size} onChange={(e) => set("max_party_size", e.target.value)} />
                </label>
              </div>
              <label className="field">
                <span>Reservation number prefix</span>
                <input maxLength={5} placeholder="NF"
                  value={f.reservation_prefix}
                  onChange={(e) => set("reservation_prefix", e.target.value.toUpperCase())} />
                <span className="small">Numbers look like {f.reservation_prefix || "RSV"}-7JA5P8</span>
              </label>
              <div className="row" style={{ gap: 8 }}>
                <label className="field" style={{ flex: 1 }}>
                  <span>Reservations open</span>
                  <input type="datetime-local" value={f.reservations_open_at}
                    onChange={(e) => set("reservations_open_at", e.target.value)} />
                </label>
                <label className="field" style={{ flex: 1 }}>
                  <span>Reservations close</span>
                  <input type="datetime-local" value={f.reservations_close_at}
                    onChange={(e) => set("reservations_close_at", e.target.value)} />
                </label>
              </div>

              <span className="eyebrow">Where new reservations go</span>
              <label className="field">
                <span>Notify email</span>
                <input type="email" placeholder="team@example.com"
                  value={f.notify_email} onChange={(e) => set("notify_email", e.target.value)} />
              </label>
              <label className="field">
                <span>Notify WhatsApp</span>
                <input type="tel" placeholder="2547XXXXXXXX"
                  value={f.notify_whatsapp} onChange={(e) => set("notify_whatsapp", e.target.value)} />
                <span className="small">
                  Needs WHATSAPP_WEBHOOK_URL configured. Leave both blank to use the dashboard only.
                </span>
              </label>
            </>
          )}

          <span className="eyebrow">Details</span>
          <label className="field">
            <span>Name</span>
            <input value={f.name} onChange={(e) => set("name", e.target.value)} />
          </label>
          <label className="field">
            <span>Tagline</span>
            <input placeholder="Building the Next Generation of Kenya's Red-Meat Economy"
              value={f.tagline} onChange={(e) => set("tagline", e.target.value)} />
          </label>
          <label className="field">
            <span>Hosted by (optional)</span>
            <input placeholder="MEATsoko Group" maxLength={80}
              value={f.host} onChange={(e) => set("host", e.target.value)} />
          </label>
          <label className="field">
            <span>Time as shown (optional)</span>
            <input placeholder="From 6:00 AM till late" maxLength={60}
              value={f.time_note} onChange={(e) => set("time_note", e.target.value)} />
            <span className="small">Replaces the hours worked out from start/end on the event page and ticket card. Start and end still control countdowns and booking.</span>
          </label>
          <label className="field">
            <span>Dress code (optional)</span>
            <input placeholder="All white" maxLength={60}
              value={f.dress_code} onChange={(e) => set("dress_code", e.target.value)} />
          </label>
          <label className="field">
            <span>Venue</span>
            <input value={f.venue} onChange={(e) => set("venue", e.target.value)} />
          </label>
          <label className="field">
            <span>Description</span>
            <textarea rows={3} value={f.description} onChange={(e) => set("description", e.target.value)} />
            <span className="small">
              Separate with | to show chips: Nyama Choma | Grills | Live Music
            </span>
          </label>
          <label className="field">
            <span>Banner image URL</span>
            <input placeholder="https://…" value={f.banner_url}
              onChange={(e) => set("banner_url", e.target.value)} />
          </label>
          <span className="eyebrow">Events page hero</span>
          <label className="field">
            <span>Big faded word (optional)</span>
            <input placeholder="NYAMA" maxLength={16}
              value={f.hero_word} onChange={(e) => set("hero_word", e.target.value)} />
            <span className="small">Sits behind the picture on /events when this is the next event. Empty = first word of the name.</span>
          </label>
          <label className="field">
            <span>Hero headline (optional)</span>
            <input placeholder="Let's feast, network & celebrate" maxLength={70}
              value={f.hero_headline} onChange={(e) => set("hero_headline", e.target.value)} />
            <span className="small">Empty = the tagline.</span>
          </label>
          <label className="field">
            <span>Hero cut-out image URL (optional)</span>
            <input placeholder="/images/events/….png" value={f.hero_image_url}
              onChange={(e) => set("hero_image_url", e.target.value)} />
            <span className="small">A transparent PNG (a person or the food, no background). Empty = the top of the banner poster.</span>
          </label>
          <div className="row" style={{ gap: 8 }}>
            <label className="field" style={{ flex: 1 }}>
              <span>Starts</span>
              <input type="datetime-local" value={f.starts_at}
                onChange={(e) => set("starts_at", e.target.value)} />
            </label>
            <label className="field" style={{ flex: 1 }}>
              <span>Ends</span>
              <input type="datetime-local" value={f.ends_at}
                onChange={(e) => set("ends_at", e.target.value)} />
            </label>
          </div>
          <label className="field">
            <span>Doors open</span>
            <input type="datetime-local" value={f.doors_open_at}
              onChange={(e) => set("doors_open_at", e.target.value)} />
          </label>
          <div className="row" style={{ gap: 8 }}>
            <label className="field" style={{ flex: 1 }}>
              <span>Contact phone</span>
              <input type="tel" value={f.contact_phone}
                onChange={(e) => set("contact_phone", e.target.value)} />
            </label>
            <label className="field" style={{ flex: 1 }}>
              <span>Contact email</span>
              <input type="email" value={f.contact_email}
                onChange={(e) => set("contact_email", e.target.value)} />
            </label>
          </div>

          {msg && (
            <p className="small" style={{ color: msg.startsWith("Saved") ? "var(--ok)" : "var(--danger)" }}>
              {msg}
            </p>
          )}
          <button className="btn-primary btn-block" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save settings"}
          </button>
          <p className="small">
            All times are Nairobi (EAT).
          </p>
        </>
      )}
    </div>
  );
}

/** Accept "dQw4w9WgXcQ", youtu.be/…, youtube.com/watch?v=…, /live/…, /embed/… — return the 11-char ID. */
function youtubeId(input: string): string {
  const t = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(t)) return t;
  const m = t.match(/(?:youtu\.be\/|[?&]v=|\/live\/|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : t;
}
