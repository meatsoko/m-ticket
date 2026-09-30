"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { invokeFn } from "@/lib/invoke";
import { openPaystackPopup } from "@/lib/paystack-popup";
import { normalizePhone, looksLikeEmail, PHONE_HINT, EMAIL_HINT } from "@/lib/phone";
import QrImage from "@/components/QrImage";
import Icon from "@/components/Icon";
import TableUpgrade, { PENDING_UPGRADE_KEY, upgradePriceKes, type UpgradeOption } from "@/components/TableUpgrade";
import { familyPackageUsdPrices, formatUsd } from "@/lib/family-package-pricing";
import type { Event } from "@/lib/types";

// "Get tickets": one panel for a General Admission event (migration
// 20260929180000). The guest picks General Admission (free, one person) or a
// table; details appear once something is picked; one button finishes.
//
// A table is still one booking with one QR: reserve creates the free ticket and,
// in the same request, starts the table upgrade for that NEW booking. If the
// payment is cancelled or fails, the guest keeps the free ticket.

const APP_URL = () => process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin;
const GA = "ga";

type Done = { reservation_number: string; access_token?: string; unchanged?: boolean; emailed: boolean; upgradeError?: string };

export default function GetTicketsPanel({
  event, gaTypeId, options, preview = false,
}: {
  event: Event;
  gaTypeId: string;
  options: UpgradeOption[];
  /** Local design preview (lib/ga-preview): simulate, never call the server. */
  preview?: boolean;
}) {
  const supabase = createClient();
  const [pick, setPick] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldErr, setFieldErr] = useState<{ name?: string; phone?: string; email?: string; agree?: string }>({});
  const [dup, setDup] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Phones: the bottom reminder bar shows only while the panel is off-screen.
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelVisible, setPanelVisible] = useState(true);
  useEffect(() => {
    const el = panelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setPanelVisible(e.isIntersecting), { threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, [done]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const table = options.find((o) => o.id === pick) ?? null;
  const earlyBird = (o: UpgradeOption) => !!o.platter.early_bird_ends_at && now < new Date(o.platter.early_bird_ends_at).getTime();
  const usd = (o: UpgradeOption) => familyPackageUsdPrices(o.platter.name);
  const priceLabel = (o: UpgradeOption) => {
    const p = usd(o);
    return p ? formatUsd(earlyBird(o) ? p.earlyBird : p.regular) : `KSh ${upgradePriceKes(o.platter, now).toLocaleString()}`;
  };

  function validate(): boolean {
    const e: typeof fieldErr = {};
    if (name.trim().length < 2) e.name = "Please enter your full name.";
    if (!normalizePhone(phone)) e.phone = phone.trim() ? `That number doesn't look right. ${PHONE_HINT}.` : `We need your phone number. ${PHONE_HINT}.`;
    if (!looksLikeEmail(email)) e.email = email.trim() ? "That email doesn't look right." : "We need your email — your ticket and QR are sent there.";
    if (!agree) e.agree = "Please accept the ticket terms to continue.";
    setFieldErr(e);
    const first = e.name ? "name" : e.phone ? "phone" : e.email ? "email" : e.agree ? "agree" : null;
    if (first) document.querySelector<HTMLInputElement>(`[data-field="${first}"]`)?.focus();
    return !first;
  }

  async function submit(allowDuplicate = false) {
    setError("");
    if (!allowDuplicate) setDup(null);
    if (!validate()) return;
    if (preview) {
      setDone({ reservation_number: "NFM-PREVIEW", access_token: "0".repeat(32), emailed: true });
      return;
    }
    setBusy(true);
    const res = await invokeFn(supabase, "reserve", {
      event_id: event.id,
      guest_name: name.trim(),
      phone,
      email: email.trim(),
      accompanying_guests: 0,
      preorders: [],
      reservation_type_id: gaTypeId,
      ...(table ? { table_type_id: table.id } : {}),
      provider: "paystack",
      ...(allowDuplicate ? { allow_duplicate_email: true } : {}),
    });
    // Before the success test: this response carries the EXISTING booking's number.
    if (res.errorCode === "email_in_use" && res.data?.reservation_number) {
      setBusy(false);
      setDup(String(res.data.reservation_number));
      return;
    }
    if (!res.data?.reservation_number) {
      setBusy(false);
      setError(explain(res.errorCode, res.transportError, res.data));
      return;
    }
    const token: string | undefined = res.data.access_token;
    const up = res.data.upgrade;
    // Table chosen and the payment opened: go and pay. The free ticket already exists.
    if (token && up?.authorizationUrl) {
      try { window.sessionStorage.setItem(PENDING_UPGRADE_KEY, JSON.stringify({ token, reference: up.reference })); } catch { /* private mode */ }
      const opened = up.accessCode && await openPaystackPopup(up.accessCode, {
        onSuccess: () => window.location.assign(`/upgrade/complete?reference=${encodeURIComponent(up.reference)}`),
        onCancel: () => window.location.assign(`/upgrade/complete?reference=${encodeURIComponent(up.reference)}`),
        onError: () => window.location.assign(up.authorizationUrl),
      });
      if (!opened) window.location.assign(up.authorizationUrl);
      return;
    }
    setBusy(false);
    setDone({
      reservation_number: res.data.reservation_number,
      access_token: token,
      unchanged: !!res.data.unchanged,
      emailed: !!res.data.emailed,
      upgradeError: up?.error,
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
          {done.upgradeError && (
            <p className="small" style={{ color: "var(--danger)" }}>
              Your free ticket is confirmed, but the table couldn&apos;t be booked ({upgradeReason(done.upgradeError)}). You can try again below.
            </p>
          )}
          <p className="small">
            {done.emailed ? `Show this at the door. We've also emailed it to ${email.trim()}.` : "Show this at the door. Screenshot it — it works offline."}
          </p>
          <QrImage value={url} />
          <strong style={{ fontSize: "1.3rem", letterSpacing: "0.04em" }}>{done.reservation_number}</strong>
          <div className="row" style={{ justifyContent: "center", gap: 8, flexWrap: "wrap" }}>
            <span className="pill ok">General Admission</span>
            <span className="pill ember">1 guest</span>
          </div>
          <a className="btn btn-ghost btn-block" href={`https://wa.me/?text=${encodeURIComponent(`My ${event.name} ticket (${done.reservation_number}) — open at the door: ${url}`)}`}>
            <Icon name="share" size={18} /> Send via WhatsApp
          </a>
          {!preview && <a className="btn-ghost btn-block" href={`/r/${done.access_token}`}>Open my pass</a>}
        </div>
        {options.length > 0 && (
          <div className="card">
            <TableUpgrade token={done.access_token} options={options} preview={preview}
              onUpgraded={() => window.location.assign(`/r/${done.access_token}`)} />
          </div>
        )}
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
          This phone number and email already have a booking, so for your security the pass isn&apos;t shown here —{" "}
          {done.emailed ? <>we&apos;ve emailed it to <strong>{email.trim()}</strong></> : "use My Tickets to have it emailed"}.
          {table && " To add a table, use the “Upgrade to a table” link in that email."}
        </p>
        <a className="btn-ghost btn-block" href="/lookup">My Tickets</a>
      </div>
    );
  }

  // ---------- Panel ----------
  const total = table ? priceLabel(table) : "Free";
  return (
    <div className="ticket-panel" id="get-tickets" ref={panelRef}>
      <div className="ticket-panel-head">
        <h2>Get tickets</h2>
        <div className="ticket-badges"><span>Instant QR</span><span>M-Pesa &amp; card</span></div>
      </div>
      {preview && <p className="small" style={{ color: "var(--danger)", margin: 0 }}>Design preview — nothing is booked, charged or emailed.</p>}

      <div className="ticket-options" role="radiogroup" aria-label="Tickets">
        <button type="button" role="radio" aria-checked={pick === GA} className={`ticket-option${pick === GA ? " on" : ""}`} onClick={() => setPick(GA)}>
          <span className="ticket-option-main">
            <strong>General Admission</strong>
            <small>Entry for one person</small>
          </span>
          <span className="ticket-option-price"><strong>Free</strong></span>
        </button>
        {options.map((o) => {
          const p = usd(o);
          const eb = earlyBird(o);
          return (
            <button type="button" role="radio" key={o.id} aria-checked={pick === o.id} className={`ticket-option${pick === o.id ? " on" : ""}`} onClick={() => setPick(o.id)}>
              <span className="ticket-option-main">
                <strong>{o.name}</strong>
                <small>{o.party_size} people · includes {o.platter.name}</small>
              </span>
              <span className="ticket-option-price">
                {eb && <em>Early bird</em>}
                <strong>{priceLabel(o)}</strong>
                {eb && p && <s>{formatUsd(p.regular)}</s>}
              </span>
            </button>
          );
        })}
      </div>

      {!pick ? (
        <p className="ticket-panel-hint">Select a ticket above to continue.</p>
      ) : (
        <div className="ticket-buyer">
          <span className="ticket-section-label">Your details</span>
          <label className="field">
            <span>Full name</span>
            <input data-field="name" autoComplete="name" placeholder="Amina Wanjiru" aria-invalid={!!fieldErr.name}
              value={name} onChange={(e) => { setName(e.target.value); setFieldErr({ ...fieldErr, name: undefined }); }} />
            {fieldErr.name && <span className="field-error">{fieldErr.name}</span>}
          </label>
          <label className="field">
            <span>Phone number</span>
            <input data-field="phone" type="tel" inputMode="numeric" autoComplete="tel" placeholder="07XX XXX XXX" aria-invalid={!!fieldErr.phone}
              value={phone} onChange={(e) => { setPhone(e.target.value); setFieldErr({ ...fieldErr, phone: undefined }); }} />
            {fieldErr.phone && <span className="field-error">{fieldErr.phone}</span>}
          </label>
          <label className="field">
            <span>Email</span>
            <input data-field="email" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" aria-invalid={!!fieldErr.email}
              value={email} onChange={(e) => { setEmail(e.target.value); setFieldErr({ ...fieldErr, email: undefined }); }} />
            {fieldErr.email ? <span className="field-error">{fieldErr.email}</span> : <span className="small">{EMAIL_HINT}.</span>}
          </label>
          <p className="small ticket-delivery-note">Your ticket and QR code are emailed instantly{table ? " — your table is added as soon as the payment goes through" : ""}.</p>
          <label className="ticket-agree">
            <input data-field="agree" type="checkbox" checked={agree} onChange={(e) => { setAgree(e.target.checked); setFieldErr({ ...fieldErr, agree: undefined }); }} />
            <span>I accept the <a href="/ticket-terms" target="_blank" rel="noopener">ticket terms &amp; refund policy</a>.</span>
          </label>
          {fieldErr.agree && <span className="field-error">{fieldErr.agree}</span>}

          {dup && (
            <div className="card quiet" style={{ gap: "var(--s3)" }}>
              <strong style={{ fontSize: ".95rem" }}>You may already have a ticket</strong>
              <p className="small">{email.trim()} already has booking <strong>{dup}</strong> at this event. If that is yours, there is no need to book again.</p>
              <a className="btn-ghost btn-block" href="/lookup">Find my existing pass</a>
              <button className="btn-primary btn-block" onClick={() => submit(true)} disabled={busy}>This is a separate person — continue</button>
            </div>
          )}
          {error && <p className="small" style={{ color: "var(--danger)" }}>{error}</p>}
        </div>
      )}

      <div className="ticket-total">
        <span>Total{pick ? ` · 1 ${table ? "table" : "ticket"}` : ""}</span>
        <strong>{pick ? total : "—"}</strong>
      </div>
      <button type="button" className={table ? "btn-pay btn-block" : "btn-primary btn-block"} disabled={!pick || busy} onClick={() => submit()}>
        {busy ? (table ? "Opening Paystack…" : "Getting your ticket…")
          : !pick ? "Select a ticket"
          : table ? `Continue to payment · ${total}` : "Get my free ticket"}
      </button>
      {table && <p className="small ticket-pay-note">Pay by M-Pesa or card on Paystack (charged in KSh). If you don&apos;t finish paying, you keep your free General Admission ticket.</p>}

      {pick && !panelVisible && (
        <a href="#get-tickets" className="ticket-mobile-bar" aria-hidden="true" tabIndex={-1}>
          <span>{table ? table.name : "General Admission"}</span><strong>{total}</strong>
        </a>
      )}
    </div>
  );
}

function upgradeReason(code: string): string {
  switch (code) {
    case "full": return "there isn't room for a table that size any more";
    case "preorder_sold_out": return "that platter is sold out";
    case "payments_unavailable": return "table payments are paused";
    case "existing_booking": return "you already have a booking";
    default: return "payment couldn't be opened";
  }
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
    default: return `Could not complete your booking${d?.stage ? ` (failed at: ${d.stage})` : ""}. Please try again.`;
  }
}
