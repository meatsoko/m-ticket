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
    venue: event.venue ?? "",
    description: event.description ?? "",
    banner_url: event.banner_url ?? "",
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
      venue: f.venue.trim(),
      description: f.description,
      banner_url: f.banner_url.trim() || null,
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
                  Turn this off while M-Pesa is still being provisioned. Guests can still
                  reserve free; platters are shown as &ldquo;Coming soon&rdquo; and no STK
                  push is attempted.
                </span>
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
            <input placeholder="Sponsored by MeatSoko"
              value={f.tagline} onChange={(e) => set("tagline", e.target.value)} />
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
