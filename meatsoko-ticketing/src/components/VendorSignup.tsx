"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { invokeFn } from "@/lib/invoke";
import { openPaystackPopup } from "@/lib/paystack-popup";
import { PAYMENTS_PAUSED, PAYMENT_PAUSED_MESSAGE } from "@/lib/payments";
import { normalizePhone, looksLikeEmail, PHONE_HINT } from "@/lib/phone";
import { MPESA_ENABLED } from "@/lib/payhero";
import MpesaPay from "@/components/payments/MpesaPay";

// "Become a vendor" (migration 20260930180000): a button on /events that
// opens a form, registers the vendor as pending, and sends them to Paystack for
// the tent fee. The registration stays pending until the payment is confirmed.

export const VENDOR_FEE_KES = 3500; // display only — vendor-apply charges the real fee
export const PENDING_VENDOR_KEY = "pending_vendor_payment";
const TYPES = [
  { id: "food", label: "Food" }, { id: "drinks", label: "Drinks" }, { id: "merchandise", label: "Merchandise" },
  { id: "services", label: "Services" }, { id: "other", label: "Other" },
];

// Shown on /events in the dark "take part" band, beside Plan a celebration.
export default function VendorSignup({ eventId, eventName }: { eventId: string; eventName: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [type, setType] = useState("");
  const [about, setAbout] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  // Paid by M-Pesa (PayHero): the registration number, shown in the dialog.
  const [paidNumber, setPaidNumber] = useState<string | null>(null);
  // Paystack paused but M-Pesa open: the M-Pesa option is the way in.
  const onlyMpesa = PAYMENTS_PAUSED && MPESA_ENABLED;
  const blocked = PAYMENTS_PAUSED && !MPESA_ENABLED;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && setOpen(false);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open, busy]);

  function validate() {
    const e: Record<string, string> = {};
    if (name.trim().length < 2) e.name = "Enter your name or business name.";
    if (!normalizePhone(phone)) e.phone = `${PHONE_HINT}.`;
    if (!looksLikeEmail(email)) e.email = "We need your email — your receipt and confirmation go there.";
    if (!type) e.type = "Choose what you'll sell.";
    setFieldErr(e);
    return !Object.keys(e).length;
  }

  async function submit() {
    setErr("");
    if (!validate()) return;
    setBusy(true);
    const res = await invokeFn(createClient(), "vendor-apply", {
      event_id: eventId, name: name.trim(), phone, email: email.trim(), vendor_type: type, description: about.trim() || null,
    });
    const d: any = res.data;
    if (!d?.authorizationUrl) {
      setBusy(false);
      setErr(explain(res.errorCode, res.transportError, d));
      return;
    }
    try { window.sessionStorage.setItem(PENDING_VENDOR_KEY, JSON.stringify({ reference: d.reference, number: d.reference_number })); } catch { /* private mode */ }
    const done = () => window.location.assign(`/vendor/complete?reference=${encodeURIComponent(d.reference)}`);
    const opened = d.accessCode && await openPaystackPopup(d.accessCode, { onSuccess: done, onCancel: done, onError: () => window.location.assign(d.authorizationUrl) });
    if (!opened) window.location.assign(d.authorizationUrl);
  }

  return (
    <>
      <div className="hero-vendor">
        <div className="hero-vendor-copy">
          <span className="hero-vendor-kicker">Vendors wanted</span>
          <strong>Selling at {eventName}?</strong>
          <span>Secure a tent for KSh {VENDOR_FEE_KES.toLocaleString("en-KE")}</span>
        </div>
        <button type="button" className={`btn-primary hero-vendor-btn${blocked ? " is-paused" : ""}`} disabled={blocked} title={blocked ? PAYMENT_PAUSED_MESSAGE : undefined} onClick={() => setOpen(true)}>{blocked ? "Payment coming soon" : "Become a vendor"}</button>
      </div>

      {/* Portalled out of the band into the app shell, which keeps the ticketing
          colours (light on the desktop layout). */}
      {open && createPortal(
        <div className="vendor-modal-root" role="dialog" aria-modal="true" aria-labelledby="vendor-title">
          <button type="button" className="vendor-modal-scrim" aria-label="Close" onClick={() => !busy && setOpen(false)} />
          <div className="vendor-modal">
            <div className="vendor-modal-head">
              <h2 id="vendor-title">Become a vendor</h2>
              <button type="button" className="vendor-close" aria-label="Close" onClick={() => !busy && setOpen(false)}>×</button>
            </div>
            <p className="small">Register for {eventName} and pay <strong>KSh {VENDOR_FEE_KES.toLocaleString("en-KE")}</strong> to secure a tent. Your registration stays pending until the payment goes through.</p>

            <label className="field"><span>Your name or business name</span>
              <input autoComplete="organization" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!fieldErr.name} placeholder="Mama Oliech Grills" />
              {fieldErr.name && <span className="field-error">{fieldErr.name}</span>}</label>
            <label className="field"><span>Phone number</span>
              <input type="tel" inputMode="numeric" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} aria-invalid={!!fieldErr.phone} placeholder="07XX XXX XXX" />
              {fieldErr.phone && <span className="field-error">{fieldErr.phone}</span>}</label>
            <label className="field"><span>Email</span>
              <input type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!fieldErr.email} placeholder="you@example.com" />
              {fieldErr.email ? <span className="field-error">{fieldErr.email}</span> : <span className="small">Your receipt and confirmation come here.</span>}</label>
            <div className="field"><span>What will you sell?</span>
              <div className="vendor-types" role="radiogroup" aria-label="Vendor type">
                {TYPES.map((t) => (
                  <button key={t.id} type="button" role="radio" aria-checked={type === t.id} className={type === t.id ? "on" : undefined} onClick={() => setType(t.id)}>{t.label}</button>
                ))}
              </div>
              {fieldErr.type && <span className="field-error">{fieldErr.type}</span>}</div>
            <label className="field"><span>Short description <em className="small">(optional)</em></span>
              <textarea rows={3} maxLength={500} value={about} onChange={(e) => setAbout(e.target.value)} placeholder="e.g. Grilled chicken and chips, one gas grill" />
              <span className="small">{about.length}/500</span></label>

            {paidNumber ? (
              <div className="card quiet" role="status" style={{ textAlign: "center" }}>
                <span className="pill ok" style={{ justifySelf: "center" }}>Paid</span>
                <strong>Your tent is secured — {paidNumber}.</strong>
                <span className="small">We&apos;ve emailed your confirmation and will contact you with your tent location and setup time.</span>
              </div>
            ) : <>
            {err && <p className="small" style={{ color: "var(--danger)" }}>{err}</p>}
            {!onlyMpesa && <>
            <button type="button" className={`btn-pay btn-block${PAYMENTS_PAUSED ? " is-paused" : ""}`} disabled={busy || PAYMENTS_PAUSED} onClick={submit}>
              {busy ? "Opening Paystack…" : `Pay KSh ${VENDOR_FEE_KES.toLocaleString("en-KE")} & secure a tent`}
            </button>
            <p className="small" style={{ textAlign: "center" }}>M-Pesa or card through Paystack.</p>
            </>}
            {MPESA_ENABLED && <>
              {!onlyMpesa && <div className="pay-or">or</div>}
              <MpesaPay amountKes={VENDOR_FEE_KES} defaultPhone={phone}
                body={() => (validate() ? { kind: "vendor", event_id: eventId, name: name.trim(), phone, email: email.trim(), vendor_type: type, description: about.trim() || null } : null)}
                explain={(code, d) => explain(code, false, d)}
                cta={`Pay KSh ${VENDOR_FEE_KES.toLocaleString("en-KE")} with M-Pesa & secure a tent`}
                onPaid={(r) => setPaidNumber(r.reference_number ?? "registered")} />
            </>}
            </>}
          </div>
        </div>,
        document.querySelector(".app") ?? document.body,
      )}
    </>
  );
}

function explain(code: string | null, transport: boolean, d: any): string {
  if (transport) return "Could not reach the registration service. Check your connection.";
  switch (code) {
    case "already_registered": return `This phone number is already a registered vendor for this event (${d?.reference_number}). Call or WhatsApp us if you need changes.`;
    case "rate_limited": return "Too many attempts. Wait a few minutes and try again.";
    case "event_not_live": return "Vendor registration isn't open for this event.";
    case "invalid_phone": return "That phone number doesn't look right. Use the format 07XX XXX XXX or 01XX XXX XXX.";
    case "email_required": return "We need a valid email for your receipt.";
    case "payments_paused": return PAYMENT_PAUSED_MESSAGE;
    case "paystack_init_failed":
    case "paystack_misconfigured": return `Your registration${d?.reference_number ? ` (${d.reference_number})` : ""} is saved as pending, but Paystack couldn't be opened. Please try again.`;
    default: return "Could not register you just now. Please try again.";
  }
}
