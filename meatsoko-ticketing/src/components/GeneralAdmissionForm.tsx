"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { invokeFn } from "@/lib/invoke";
import { normalizePhone, looksLikeEmail, PHONE_HINT, EMAIL_HINT } from "@/lib/phone";
import QrImage from "@/components/QrImage";
import Icon from "@/components/Icon";
import TableUpgrade, { type UpgradeOption } from "@/components/TableUpgrade";
import { familyPackageUsdPrices, formatUsd } from "@/lib/family-package-pricing";
import type { Event } from "@/lib/types";

// The free, one-person General Admission ticket (migration 20260929180000).
// It is a normal reservation — booking number, QR pass, emailed — and is the
// only thing this form creates. Tables are an upgrade of the ticket afterwards
// (TableUpgrade), authorised by the pass itself.

const APP_URL = () => process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin;

type Result = { reservation_number: string; access_token?: string; unchanged?: boolean; emailed: boolean };

export default function GeneralAdmissionForm({
  event, gaTypeId, options,
}: {
  event: Event;
  gaTypeId: string;
  options: UpgradeOption[];
}) {
  const supabase = createClient();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldErr, setFieldErr] = useState<{ name?: string; phone?: string; email?: string }>({});
  const [dup, setDup] = useState<string | null>(null);
  const [done, setDone] = useState<Result | null>(null);

  function validate(): boolean {
    const e: { name?: string; phone?: string; email?: string } = {};
    if (name.trim().length < 2) e.name = "Please enter your full name.";
    if (!normalizePhone(phone)) e.phone = phone.trim() ? `That number doesn't look right. ${PHONE_HINT}.` : `We need your phone number. ${PHONE_HINT}.`;
    if (!looksLikeEmail(email)) e.email = email.trim() ? "That email doesn't look right." : "We need your email — your ticket and QR are sent there.";
    setFieldErr(e);
    const first = e.name ? "name" : e.phone ? "phone" : e.email ? "email" : null;
    if (first) document.querySelector<HTMLInputElement>(`[data-field="${first}"]`)?.focus();
    return !first;
  }

  async function submit(allowDuplicate = false) {
    setError("");
    if (!allowDuplicate) setDup(null);
    if (!validate()) return;
    setBusy(true);
    const res = await invokeFn(supabase, "reserve", {
      event_id: event.id,
      guest_name: name.trim(),
      phone,
      email: email.trim(),
      accompanying_guests: 0,
      preorders: [],
      reservation_type_id: gaTypeId,
      provider: "paystack",
      ...(allowDuplicate ? { allow_duplicate_email: true } : {}),
    });
    setBusy(false);
    // Before the success test: this response carries the EXISTING booking's number.
    if (res.errorCode === "email_in_use" && res.data?.reservation_number) {
      setDup(String(res.data.reservation_number));
      return;
    }
    if (!res.data?.reservation_number) { setError(explain(res.errorCode, res.transportError, res.data)); return; }
    setDone({
      reservation_number: res.data.reservation_number,
      access_token: res.data.access_token,
      unchanged: !!res.data.unchanged,
      emailed: !!res.data.emailed,
    });
  }

  // ---------- Ticket issued ----------
  if (done?.access_token) {
    const url = `${APP_URL()}/r/${done.access_token}`;
    return (
      <div className="stack">
        <div className="card" style={{ alignItems: "center", textAlign: "center" }}>
          <span className="pill ok">Ticket confirmed</span>
          <h2>See you there, {name.split(" ")[0]}.</h2>
          <p className="small">
            {done.emailed ? `Show this at the door. We've also emailed it to ${email.trim()}.`
              : "Show this at the door. Screenshot it — it works offline."}
          </p>
          <QrImage value={url} />
          <strong style={{ fontSize: "1.3rem", letterSpacing: "0.04em" }}>{done.reservation_number}</strong>
          <div className="row" style={{ justifyContent: "center", gap: 8, flexWrap: "wrap" }}>
            <span className="pill ok">General Admission</span>
            <span className="pill ember">1 guest</span>
          </div>
          <a className="btn btn-ghost btn-block" href={`https://wa.me/?text=${encodeURIComponent(
            `My ${event.name} ticket (${done.reservation_number}) — open at the door: ${url}`)}`}>
            <Icon name="share" size={18} /> Send via WhatsApp
          </a>
          <a className="btn-ghost btn-block" href={`/r/${done.access_token}`}>Open my pass</a>
        </div>
        {options.length > 0 && (
          <div className="card">
            <TableUpgrade token={done.access_token} options={options}
              onUpgraded={() => window.location.assign(`/r/${done.access_token}`)} />
          </div>
        )}
        <p className="small" style={{ textAlign: "center" }}>
          You can upgrade to a table any time from your pass. Lost it? <a href="/lookup">My Tickets</a>.
        </p>
      </div>
    );
  }

  // ---------- Existing booking: pass emailed, never shown here ----------
  if (done) {
    return (
      <div className="card" style={{ alignItems: "center", textAlign: "center" }}>
        <span className="pill ok">{done.unchanged ? "Already booked" : "Ticket updated"}</span>
        <h2>You&apos;re already on the list, {name.split(" ")[0]}.</h2>
        <strong style={{ fontSize: "1.3rem", letterSpacing: "0.04em" }}>{done.reservation_number}</strong>
        <p className="small">
          This phone number and email already have a booking, so for your security the pass isn&apos;t
          shown here — {done.emailed ? <>we&apos;ve emailed it to <strong>{email.trim()}</strong></> : "use My Tickets to have it emailed"}.
          {options.length > 0 && " To add a table, use the upgrade link in that email."}
        </p>
        <a className="btn-ghost btn-block" href="/lookup">My Tickets</a>
      </div>
    );
  }

  // ---------- Form ----------
  const now = Date.now();
  return (
    <div className="stack reservation-form general-admission">
      <div className="stack tight">
        <span className="eyebrow">General Admission</span>
        <h2 style={{ margin: 0 }}>Grab Your Free Ticket</h2>
        <p className="small">Free entry for one person. Your ticket and QR code are emailed to you.</p>
      </div>
      <div className="card">
        <label className="field">
          <span>Full name</span>
          <input data-field="name" autoComplete="name" placeholder="Amina Wanjiru" aria-invalid={!!fieldErr.name}
            value={name} onChange={(e) => { setName(e.target.value); setFieldErr({ ...fieldErr, name: undefined }); }} />
          {fieldErr.name && <span className="field-error">{fieldErr.name}</span>}
        </label>
        <label className="field">
          <span>Phone number</span>
          <input data-field="phone" type="tel" inputMode="numeric" autoComplete="tel" placeholder="07XX XXX XXX"
            aria-invalid={!!fieldErr.phone}
            value={phone} onChange={(e) => { setPhone(e.target.value); setFieldErr({ ...fieldErr, phone: undefined }); }} />
          {fieldErr.phone && <span className="field-error">{fieldErr.phone}</span>}
        </label>
        <label className="field">
          <span>Email</span>
          <input data-field="email" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com"
            aria-invalid={!!fieldErr.email}
            value={email} onChange={(e) => { setEmail(e.target.value); setFieldErr({ ...fieldErr, email: undefined }); }} />
          {fieldErr.email ? <span className="field-error">{fieldErr.email}</span> : <span className="small">{EMAIL_HINT}.</span>}
        </label>
        {dup && (
          <div className="card quiet" style={{ gap: "var(--s3)" }}>
            <strong style={{ fontSize: ".95rem" }}>You may already have a ticket</strong>
            <p className="small">
              {email.trim()} already has booking <strong>{dup}</strong> at this event. If that is yours, there is
              no need to book again.
            </p>
            <a className="btn-ghost btn-block" href="/lookup">Find my existing pass</a>
            <button className="btn-primary btn-block" onClick={() => submit(true)} disabled={busy}>
              This is a separate person — get another ticket
            </button>
          </div>
        )}
        {error && <p className="small" style={{ color: "var(--danger)" }}>{error}</p>}
        <button className="btn-primary btn-block" onClick={() => submit()} disabled={busy}>
          {busy ? "Getting your ticket…" : "Get my free ticket"}
        </button>
      </div>

      {options.length > 0 && (
        <div className="stack tight">
          <span className="eyebrow">Coming as a group?</span>
          <p className="small">
            Get your free ticket first, then upgrade it to a table with a family platter — same QR code for your whole table.
          </p>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {options.map((o) => {
              const usd = familyPackageUsdPrices(o.platter.name);
              const eb = !!o.platter.early_bird_ends_at && now < new Date(o.platter.early_bird_ends_at).getTime();
              return (
                <span className="pill" key={o.id}>
                  {o.platter.name} · {o.party_size} people{usd ? ` · ${formatUsd(eb ? usd.earlyBird : usd.regular)}` : ""}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function explain(code: string | null, transport: boolean, d: any): string {
  if (transport) return "Could not reach the booking service. Check your connection.";
  switch (code) {
    case "rate_limited": return `Too many attempts. Wait ${Math.ceil((d?.retry_after ?? 60) / 60)} minute(s) and try again.`;
    case "full": return "Sorry — the event is full.";
    case "closed": return "Bookings for this event have closed.";
    case "not_open_yet": return "Bookings aren't open yet. Check back soon.";
    case "invalid_phone": return "That phone number doesn't look right. Use the format 07XX XXX XXX.";
    case "invalid_name": return "Please enter your full name.";
    case "email_required": return "We need a valid email — your ticket and QR are sent there.";
    default: return `Could not issue your ticket${d?.stage ? ` (failed at: ${d.stage})` : ""}. Please try again.`;
  }
}
