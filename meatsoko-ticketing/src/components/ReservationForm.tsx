"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { invokeFn } from "@/lib/invoke";
import { openPaystackPopup } from "@/lib/paystack-popup";
import { PAYMENTS_PAUSED, PAYMENT_PAUSED_MESSAGE } from "@/lib/payments";
import { normalizePhone, looksLikeEmail, PHONE_HINT, EMAIL_HINT } from "@/lib/phone";
import QrImage from "@/components/QrImage";
import Icon from "@/components/Icon";
import type { Event, PreorderItem, ReservationType } from "@/lib/types";
import { familyPackageUsdPrices, formatUsd, formatUsdSaving } from "@/lib/family-package-pricing";

const APP_URL = () => process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin;

type Phase = "form" | "submitting" | "awaiting_payment" | "done" | "failed";

// Paystack (M-Pesa or card, in a popup) is the payment path, as for tickets and
// merchandise. Direct M-Pesa STK via Daraja is kept for when Safaricom enables
// M-Pesa Express on the shortcode; until then offering it would only fail.
const DARAJA_ENABLED = process.env.NEXT_PUBLIC_DARAJA_ENABLED === "on";
type BookingStep = "selection" | "details" | "payment";

type Confirmed = {
  reservation_number: string;
  // Absent when an existing booking was amended: the pass is then emailed to the
  // address on the booking, never shown to whoever submitted the form.
  access_token?: string;
  party_size: number;
  amount_kes: number;
};

export default function ReservationForm({
  event, items, types = [],
}: {
  event: Event;
  items: PreorderItem[];
  types?: ReservationType[];
}) {
  const supabase = createClient();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [provider, setProvider] = useState<"mpesa" | "paystack">(DARAJA_ENABLED ? "mpesa" : "paystack");
  const [nowMs, setNowMs] = useState<number | null>(null);
  // A type's smallest legal party, expressed as "people besides you".
  const startingExtra = (t?: ReservationType | null) =>
    Math.max(0, (t?.fixed_party_size ?? t?.min_party_size ?? 1) - 1);
  const [typeId, setTypeId] = useState<string>(types[0]?.id ?? "");
  const [accompanying, setAccompanying] = useState(() => startingExtra(types[0]));
  const initialPackageItem = types[0]?.included_preorder_item_id;
  const [qty, setQty] = useState<Record<string, number>>(() => initialPackageItem ? { [initialPackageItem]: 1 } : {});
  const [step, setStep] = useState<BookingStep>("selection");
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const [phase, setPhase] = useState<Phase>("form");
  const [error, setError] = useState("");
  const [done, setDone] = useState<Confirmed | null>(null);
  const [emailed, setEmailed] = useState(false);
  const [fieldErr, setFieldErr] = useState<{ name?: string; phone?: string; email?: string }>({});
  // Set when this email already holds a reservation under a different phone.
  const [dup, setDup] = useState<{ reservation_number: string; party_size: number } | null>(null);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get("payment") !== "paystack" || query.get("flow") !== "reservation") return;
    window.history.replaceState({}, "", window.location.pathname);
    const saved = window.sessionStorage.getItem("pending_paystack_reservation");
    if (!saved) {
      setError("We couldn't restore this reservation after checkout. Find your pass under My Tickets or contact support with your payment reference.");
      setPhase("failed");
      return;
    }
    let pending: { reservation: Confirmed; name: string; email: string; emailed: boolean };
    try { pending = JSON.parse(saved); }
    catch {
      window.sessionStorage.removeItem("pending_paystack_reservation");
      setError("We couldn't restore this reservation after checkout. Find your pass under My Tickets or contact support.");
      setPhase("failed");
      return;
    }
    setDone(pending.reservation);
    setName(pending.name);
    setEmail(pending.email);
    setEmailed(pending.emailed);
    setProvider("paystack");
    completePaystack(query.get("reference"), pending.reservation.access_token);
  // Callback verification runs once when Paystack returns to this page.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After Paystack says the guest paid — by popup callback or by redirect back here.
  async function completePaystack(reference: string | null, accessToken?: string) {
    setPhase("awaiting_payment");
    const verified = reference
      ? await invokeFn(supabase, "paystack-verify", { reference })
      : { data: null };
    if (!verified.data || !["confirmed", "already"].includes(verified.data.result)) {
      setError("Paystack did not confirm this preorder. If you were charged, contact support with your payment reference.");
      setPhase("failed");
      return;
    }
    // An amended booking has no token here; its pass is emailed once payment confirms.
    if (!accessToken) {
      window.sessionStorage.removeItem("pending_paystack_reservation");
      setPhase("done");
      return;
    }
    const { data: status } = await invokeFn(supabase, "reservation-status", { access_token: accessToken });
    if (status?.status === "confirmed" || status?.payment_status === "paid") {
      window.sessionStorage.removeItem("pending_paystack_reservation");
      setPhase("done");
      return;
    }
    setError("Payment received but we could not confirm your preorder. Our team has been alerted — contact support with your payment reference.");
    setPhase("failed");
  }

  useEffect(() => {
    if (!items.some((item) => item.early_bird_ends_at)) return;
    const tick = () => setNowMs(Date.now());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [items]);

  // Payments can be switched off per event while providers are being configured.
  // The preorder catalogue remains visible, but guests cannot add items.
  const selected = types.find((t) => t.id === typeId) ?? null;
  // A type that fixes the party size owns it; only a "group" asks the guest.
  const fixed = selected?.fixed_party_size ?? null;
  const asksForCount = types.length === 0 || fixed === null;
  const hasTablePackages = types.some((t) => !!t.included_preorder_item);
  const invalidSelectedPackage = hasTablePackages &&
    (!selected?.included_preorder_item || selected.fixed_party_size == null);
  const includedItemId = selected?.included_preorder_item_id ?? null;
  const chosenQty = (i: PreorderItem) => i.id === includedItemId ? 1 : (qty[i.id] || 0);
  const preorders = items
    .filter((i) => chosenQty(i) > 0)
    .map((i) => ({ preorder_item_id: i.id, qty: chosenQty(i) }));
  const earlyBirdActive = (item: PreorderItem) => !!item.early_bird_ends_at &&
    (nowMs === null || nowMs < new Date(item.early_bird_ends_at).getTime());
  const currentPrice = (item: PreorderItem) => earlyBirdActive(item) || !item.compare_at_price_kes
    ? Number(item.price_kes)
    : Number(item.compare_at_price_kes);
  const total = items.reduce((s, i) => s + chosenQty(i) * currentPrice(i), 0);
  // A paid booking that would go to Paystack while it is paused.
  const payPaused = PAYMENTS_PAUSED && total > 0 && provider === "paystack";
  const partySize = fixed ?? 1 + accompanying;
  const maxParty = Math.min(
    event.max_party_size ?? 10,
    selected?.max_party_size ?? event.max_party_size ?? 10
  );
  const minParty = selected?.min_party_size ?? 1;

  function chooseType(t: ReservationType) {
    setTypeId(t.id);
    setAccompanying(startingExtra(t));
    const next = { ...qty };
    for (const type of types) {
      if (type.included_preorder_item_id) delete next[type.included_preorder_item_id];
    }
    if (t.included_preorder_item_id) next[t.included_preorder_item_id] = 1;
    setQty(next);
  }

  /**
   * The primary action is never disabled. A greyed-out button with no
   * explanation is a dead end — the guest cannot tell whether the app is broken
   * or they have missed something. Validate on press and say what is wrong,
   * next to the field that is wrong.
   */
  function validate(): boolean {
    const e: { name?: string; phone?: string; email?: string } = {};
    if (name.trim().length < 2) e.name = "Please enter your full name.";
    if (!normalizePhone(phone)) {
      e.phone = phone.trim()
        ? `That number doesn't look right. ${PHONE_HINT}.`
        : `We need your ${provider === "mpesa" ? "M-Pesa" : "contact"} number. ${PHONE_HINT}.`;
    }
    // Mandatory: the pass, the QR and the order summary are delivered here.
    // Without it the guest has no durable copy of their reservation.
    if (!looksLikeEmail(email)) {
      e.email = email.trim()
        ? "That email doesn't look right."
        : "We need your email — your pass and QR are sent there.";
    }
    setFieldErr(e);
    const first = e.name ? "name" : e.phone ? "phone" : e.email ? "email" : null;
    if (first) {
      document.querySelector<HTMLInputElement>(`[data-field="${first}"]`)?.focus();
      return false;
    }
    return true;
  }

  async function submit(allowDuplicate = false) {
    setError("");
    if (!allowDuplicate) setDup(null);
    if (!validate()) return;
    setPhase("submitting");

    const res = await invokeFn(supabase, "reserve", {
      event_id: event.id,
      guest_name: name.trim(),
      phone,
      email: email.trim(),
      accompanying_guests: accompanying,
      preorders,
      ...(typeId ? { reservation_type_id: typeId } : {}),
      ...(allowDuplicate ? { allow_duplicate_email: true } : {}),
      provider,
    });

    // Must come BEFORE the success test: this response also carries a
    // reservation_number — the EXISTING one — so reading that first would show
    // someone else's booking as their confirmation.
    if (res.errorCode === "email_in_use" && res.data?.reservation_number) {
      setDup({
        reservation_number: String(res.data.reservation_number),
        party_size: Number(res.data.party_size ?? 1),
      });
      setPhase("form");
      return;
    }

    if (!res.data?.reservation_number) {
      setError(explain(res));
      setPhase("failed");
      return;
    }

    setEmailed(!!res.data.emailed);
    const confirmed: Confirmed = {
      reservation_number: res.data.reservation_number,
      access_token: res.data.access_token,
      party_size: res.data.party_size,
      amount_kes: res.data.amount_kes ?? 0,
    };
    setDone(confirmed);

    // Free reservation: already confirmed, no payment step at all.
    if (!res.data.payment_required) {
      setPhase("done");
      return;
    }

    if (res.data.authorizationUrl) {
      // Saved for the redirect fallback, which comes back to this page and restores from it.
      const pending = { reservation: confirmed, name: name.trim(), email: email.trim(), emailed: false };
      window.sessionStorage.setItem("pending_paystack_reservation", JSON.stringify(pending));
      const { authorizationUrl, accessCode, reference } = res.data;
      setPhase("awaiting_payment");
      const opened = accessCode && await openPaystackPopup(accessCode, {
        onSuccess: (tx) => completePaystack(tx?.reference || reference, confirmed.access_token),
        // Closed without a success callback: ask Paystack before assuming nothing was paid.
        onCancel: async () => {
          const checked = await invokeFn(supabase, "paystack-verify", { reference });
          if (["confirmed", "already"].includes(checked.data?.result)) { completePaystack(reference, confirmed.access_token); return; }
          setError("Payment window closed before paying. Your reservation is held — tap below to pay again.");
          setPhase("failed");
        },
        onError: () => window.location.assign(authorizationUrl),
      });
      if (!opened) window.location.assign(authorizationUrl);   // script blocked: hosted page as before
      return;
    }

    // Amended booking: no token to poll with; the updated pass is emailed once
    // the M-Pesa payment confirms.
    if (!confirmed.access_token) { setPhase("done"); return; }

    // Preorder: the STK prompt is already on the guest's phone. Poll the
    // reservation, not the order — the access token is unguessable.
    setPhase("awaiting_payment");
    for (let i = 0; i < 34; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const { data: st } = await invokeFn(supabase, "reservation-status", {
        access_token: confirmed.access_token,
      });
      if (st?.status === "confirmed" || st?.payment_status === "paid") { setPhase("done"); return; }
      if (st?.payment_status === "failed") {
        setError("Payment was cancelled or timed out. Your reservation is held — tap below to pay again.");
        setPhase("failed");
        return;
      }
      if (st?.payment_status === "flagged") {
        setError("Payment received but we could not confirm your preorder. Our team has been alerted — contact us with your M-Pesa message.");
        setPhase("failed");
        return;
      }
    }
    setError("Payment not completed in time. Your reservation is held — you can pay again below.");
    setPhase("failed");
  }

  function explain(res: { data: any; errorCode: string | null; transportError: boolean }): string {
    if (res.transportError) return "Could not reach the reservation service. Check your connection.";
    const d = res.data ?? {};
    switch (res.errorCode) {
      case "phone_in_use":
        return d.masked_email
          ? `This phone number already has a booking under ${d.masked_email}. Use that email to update it, or book with a different phone number.`
          : "This phone number already has a booking. Book with a different phone number, or contact the organiser to change it.";
      case "rate_limited":
        return `Too many attempts. Wait ${Math.ceil((d.retry_after ?? 60) / 60)} minute(s) and try again.`;
      case "full":
        return `Sorry — the guest list is full${d.remaining ? `. Only ${d.remaining} place(s) left` : ""}.`;
      case "party_too_large":
        return `${d.type ?? "This option"} is limited to ${d.max_party_size} people.`;
      case "party_too_small":
        return `${d.type ?? "This option"} needs at least ${d.min_party_size} people.`;
      case "bad_reservation_type":
        return "That option is no longer available. Pick another.";
      case "table_package_requires_fixed_party_size":
        return "This table package is not configured with a fixed guest count. Please contact the organizer.";
      case "preorder_sold_out":
        return `${d.item ?? "That item"} is sold out${d.remaining ? ` — ${d.remaining} left` : ""}.`;
      case "closed":
        return "Reservations for this event have closed.";
      case "not_open_yet":
        return "Reservations aren't open yet. Check back soon.";
      case "invalid_phone":
        return "That phone number doesn't look right. Use the format 07XX XXX XXX or 01XX XXX XXX.";
      case "invalid_name":
        return "Please enter your full name.";
      case "email_required":
      case "invalid_email":
        return "We need a valid email — your pass and QR are sent there.";
      case "preorder_required":
        return "This event requires a preorder. Select at least one item.";
      case "stk_failed":
        return "M-Pesa did not accept the payment request. Your place is held — try paying again.";
      case "paystack_init_failed":
        return "Could not open Paystack checkout. Your place is held — try again.";
      case "payments_paused":
        return PAYMENT_PAUSED_MESSAGE;
      case "paystack_misconfigured":
        return "Paystack is temporarily unavailable. Please try again shortly.";
      case "payments_unavailable":
        return "Preordering isn't open yet. Your place can still be reserved for free.";
      default:
        return `Could not complete your reservation${d.stage ? ` (failed at: ${d.stage})` : ""}. Please try again.`;
    }
  }

  // ---------- Confirmed ----------
  if (phase === "done" && done && !done.access_token) {
    return (
      <div className="stack">
        <div className="card" style={{ alignItems: "center", textAlign: "center" }}>
          <span className="pill ok">Booking updated</span>
          <h2>You&apos;re all set, {name.split(" ")[0]}.</h2>
          <strong style={{ fontSize: "1.3rem", letterSpacing: "0.04em" }}>{done.reservation_number}</strong>
          <p className="small">
            This phone number already had a booking, so we&apos;ve updated it. For your security the
            pass isn&apos;t shown here — {done.amount_kes > 0 ? "once your payment is confirmed, " : ""}we&apos;ve
            emailed it to <strong>{email.trim()}</strong>.
          </p>
        </div>
        <p className="small" style={{ textAlign: "center" }}>
          No email? Use <a href="/lookup">My Tickets</a> to send it again.
        </p>
      </div>
    );
  }

  if (phase === "done" && done) {
    const url = `${APP_URL()}/r/${done.access_token}`;
    return (
      <div className="stack">
        <div className="card" style={{ alignItems: "center", textAlign: "center" }}>
          <span className="pill ok">Reservation confirmed</span>
          <h2>See you there, {name.split(" ")[0]}.</h2>
          <p className="small">
            {emailed
              ? `Show this at the door. We've also emailed it to ${email.trim()}.`
              : "Show this at the door. Screenshot it — it works offline."}
          </p>
          <QrImage value={url} />
          <strong style={{ fontSize: "1.3rem", letterSpacing: "0.04em" }}>{done.reservation_number}</strong>
          <span className="pill ember">
            {done.party_size} {done.party_size === 1 ? "guest" : "guests"}
          </span>
          {done.amount_kes > 0 && (
            <span className="pill ok">Preorder paid · KSh {done.amount_kes.toLocaleString()}</span>
          )}
          <a
            className="btn btn-ghost btn-block"
            href={`https://wa.me/?text=${encodeURIComponent(
              `My ${event.name} reservation (${done.reservation_number}) — open at the door: ${url}`
            )}`}
          >
            <Icon name="share" size={18} /> Send via WhatsApp
          </a>
        </div>
        <p className="small" style={{ textAlign: "center" }}>
          Lost this page? Find it again under <a href="/lookup">My Tickets</a>.
        </p>
      </div>
    );
  }

  // ---------- Awaiting payment ----------
  if (phase === "awaiting_payment") {
    return (
      <div className="card" style={{ textAlign: "center" }}>
        <span className="pill warn">Waiting for payment</span>
        <h2>{provider === "mpesa" ? "Check your phone" : "Opening Paystack"}</h2>
        <p className="small">
          {provider === "mpesa"
            ? <>Enter your M-Pesa PIN to pay <strong>KSh {total.toLocaleString()}</strong>. Your pass will appear here after payment is confirmed.</>
            : <>Taking you to Paystack to pay <strong>KSh {total.toLocaleString()}</strong> by card or M-Pesa. Your pass appears here once it&apos;s confirmed.</>}
        </p>
      </div>
    );
  }

  // ---------- Form ----------
  return (
    <div className={`stack reservation-form reservation-step-${step}`}>
      <span className="eyebrow">Reserve your place</span>
      <div className="row" aria-label="Booking steps">
        <span className={`pill ${step === "selection" ? "ok" : ""}`}>1 · Platter</span>
        <span className={`pill ${step === "details" ? "ok" : ""}`}>2 · Your details</span>
        <span className={`pill ${step === "payment" ? "ok" : ""}`}>3 · Payment</span>
      </div>

      {step === "selection" && <>
      {types.length > 0 && (
        <div className="stack tight">
          <span className="eyebrow">Choose your platter package</span>
          <div className="package-card-grid">
          {types.map((t) => {
            const platter = t.included_preorder_item;
            const usdPrices = platter ? familyPackageUsdPrices(platter.name) : null;
            const isEarlyBird = platter ? earlyBirdActive(platter) : false;
            return (
              <label key={t.id} className={`card table-package-card package-card ${typeId === t.id ? "selected" : "quiet"}`}
                style={{ padding: 12, cursor: "pointer", gap: 8, border: typeId === t.id ? "2px solid var(--ember)" : undefined }}>
                {platter?.image_url && !failedImages[platter.id] ? (
                  <img src={platter.image_url} alt={`${platter.name}, included with ${t.name}`} loading="lazy"
                    onError={() => setFailedImages((v) => ({ ...v, [platter.id]: true }))}
                    className="table-package-image" />
                ) : platter ? (
                  <div role="img" aria-label={`${platter.name} image unavailable`}
                    className="table-package-image table-package-fallback">
                    <span className="small">Platter photo coming soon</span>
                  </div>
                ) : null}
                <div className="row package-card-info">
                  <div className="stack tight" style={{ minWidth: 0 }}>
                    <strong style={{ fontSize: "1rem" }}>{t.name}</strong>
                    <span className="small">
                      {t.fixed_party_size ? `${t.fixed_party_size} people` : platter ? "Package unavailable" : `${t.min_party_size}–${t.max_party_size ?? maxParty} people`}
                    </span>
                    {platter && <span className="small package-included-name">Includes {platter.name}</span>}
                    {platter?.description && <span className="small package-description">
                      {platter.description.replace(/\s*all goat meat is roasted\.?\s*/gi, " ").trim().replace(/[\s.]+$/, ".")}
                    </span>}
                    {platter && (usdPrices ? (
                      <span className="package-price-block">
                        <span className="price">
                          {isEarlyBird ? "Early Bird · " : ""}{formatUsd(isEarlyBird ? usdPrices.earlyBird : usdPrices.regular)}
                          {isEarlyBird && <span className="small package-price-was">{formatUsd(usdPrices.regular)}</span>}
                        </span>
                        {isEarlyBird && <span className="package-saving">Save {formatUsdSaving(usdPrices.regular - usdPrices.earlyBird)}</span>}
                      </span>
                    ) : <span className="price">
                      {earlyBirdActive(platter) ? "Early Bird · " : ""}KSh {currentPrice(platter).toLocaleString()}
                      {earlyBirdActive(platter) && platter.compare_at_price_kes && Number(platter.compare_at_price_kes) > Number(platter.price_kes) && <span className="small" style={{ textDecoration: "line-through", marginLeft: 8 }}>
                        KSh {Number(platter.compare_at_price_kes).toLocaleString()}
                      </span>}
                    </span>)}
                  </div>
                  <input type="radio" name="reservation_type" checked={typeId === t.id}
                    onChange={() => chooseType(t)} aria-label={`Choose ${t.name}`}
                    disabled={!!platter && t.fixed_party_size == null}
                    style={{ width: 20, height: 20, margin: 0, flex: "0 0 auto" }} />
                </div>
              </label>
            );
          })}
          </div>
        </div>
      )}

      {!hasTablePackages && asksForCount && (
        <div className="row">
          <div className="stack tight" style={{ minWidth: 0 }}>
            <strong>How many of you?</strong>
            <span className="small">{partySize} {partySize === 1 ? "person" : "people"} in total, including you</span>
          </div>
          <div className="stepper" data-stepper="party">
            <button onClick={() => setAccompanying(Math.max(startingExtra(selected), accompanying - 1))}
              disabled={partySize <= minParty} aria-label="One fewer guest">−</button>
            <span className="qty" aria-live="polite">{partySize}</span>
            <button onClick={() => setAccompanying(accompanying + 1)}
              disabled={partySize >= maxParty} aria-label="One more guest">+</button>
          </div>
        </div>
      )}

      <div className="card">
        {total > 0 && <div className="row"><span>Package total</span><strong className="num">KSh {total.toLocaleString()}</strong></div>}
        {invalidSelectedPackage && <p className="small" style={{ color: "var(--danger)" }}>
          This platter package needs a fixed guest count before it can be booked.
        </p>}
        <button className="btn-primary btn-block" onClick={() => setStep("details")} disabled={invalidSelectedPackage}>
          Continue to your details
        </button>
      </div>
      </>}

      {step === "details" && <>
      <div className="card">
        <label className="field">
          <span>Full name</span>
          <input data-field="name" autoComplete="name" placeholder="Amina Wanjiru"
            aria-invalid={!!fieldErr.name}
            value={name}
            onChange={(e) => { setName(e.target.value); setFieldErr({ ...fieldErr, name: undefined }); }} />
          {fieldErr.name && <span className="field-error">{fieldErr.name}</span>}
        </label>
        <label className="field">
          <span>Phone number</span>
          <input data-field="phone" type="tel" inputMode="numeric" autoComplete="tel"
            placeholder="07XX XXX XXX" aria-invalid={!!fieldErr.phone}
            value={phone}
            onChange={(e) => { setPhone(e.target.value); setFieldErr({ ...fieldErr, phone: undefined }); }} />
          {fieldErr.phone && <span className="field-error">{fieldErr.phone}</span>}
        </label>
        <label className="field">
          <span>Email</span>
          <input data-field="email" type="email" inputMode="email" autoComplete="email"
            placeholder="you@example.com" aria-invalid={!!fieldErr.email}
            value={email}
            onChange={(e) => { setEmail(e.target.value); setFieldErr({ ...fieldErr, email: undefined }); }} />
          {fieldErr.email
            ? <span className="field-error">{fieldErr.email}</span>
            : <span className="small">{EMAIL_HINT}.</span>}
        </label>

      </div>
      <button className="btn-ghost btn-block" onClick={() => setStep("selection")} style={{ minHeight: 42 }}>
        Back to platter selection
      </button>
      <button className="btn-primary btn-block" onClick={() => { if (validate()) setStep("payment"); }}>
        Continue to payment
      </button>
      </>}

      {step === "payment" && <>
      <div className="card">
        <span className="eyebrow">Payment summary</span>
        <div className="row">
          <div className="stack tight">
            <strong>{selected?.name ?? "Reservation"}</strong>
            {selected?.included_preorder_item && <span className="small">Includes {selected.included_preorder_item.name}</span>}
          </div>
          <strong className="num">KSh {total.toLocaleString()}</strong>
        </div>
        {total > 0 && !hasTablePackages && DARAJA_ENABLED && (
          <label className="field">
            <span>Payment method</span>
            <select value={provider} onChange={(e) => setProvider(e.target.value as "mpesa" | "paystack")}>
              <option value="mpesa">M-Pesa STK push</option>
              <option value="paystack">Paystack (M-Pesa or card)</option>
            </select>
          </label>
        )}
        {total > 0 && hasTablePackages && (
          <p className="small">{provider === "mpesa"
            ? <>We&apos;ll send an M-Pesa STK prompt to {phone || "your phone"} when you continue.</>
            : <>You&apos;ll pay by M-Pesa or card through Paystack when you continue.</>}</p>
        )}
        <button className="btn-ghost btn-block" onClick={() => setStep("details")} style={{ minHeight: 42 }}>
          Back to your details
        </button>
      </div>
      <div className="card">
        {dup && (
          <div className="card quiet" style={{ gap: "var(--s3)" }}>
            <strong style={{ fontSize: ".95rem" }}>You may already have a place</strong>
            <p className="small">
              {email.trim()} already has reservation <strong>{dup.reservation_number}</strong>
              {dup.party_size > 1 ? ` for ${dup.party_size} people` : ""} at this event.
              If that is yours, there is no need to reserve again — bring it as it is.
            </p>
            <a className="btn-ghost btn-block" href="/lookup">Find my existing pass</a>
          <button
            className="btn-primary btn-block"
            onClick={() => submit(true)}
              disabled={phase === "submitting" || payPaused}
            >
              This is a separate booking — reserve anyway
            </button>
            <p className="small">
              Reserving for someone else on your email is fine. Two places are only a
              problem if nobody uses the first one.
            </p>
          </div>
        )}
        {error && <p className="small" style={{ color: "var(--danger)" }}>{error}</p>}
        {payPaused && <p className="pay-paused-note" role="status">{PAYMENT_PAUSED_MESSAGE}</p>}
        <button className={`${total > 0 ? "btn-pay btn-block" : "btn-primary btn-block"}${payPaused ? " is-paused" : ""}`}
          onClick={() => submit()} disabled={phase === "submitting" || payPaused}>
          {phase === "submitting"
            ? provider === "mpesa" ? "Sending M-Pesa prompt…" : "Opening Paystack…"
            : total > 0
            ? `${phase === "failed" ? "Retry payment —" : provider === "mpesa" ? "Send M-Pesa prompt" : "Pay"} · KSh ${total.toLocaleString()}`
            : phase === "failed" ? "Try again" : "Confirm reservation"}
        </button>
        <p className="small" style={{ textAlign: "center" }}>
          {total > 0
            ? provider === "mpesa"
              ? "An M-Pesa prompt will be sent to your phone. Your pass appears after payment is confirmed."
              : "Pay by M-Pesa or card through Paystack. Your pass appears after payment is confirmed."
            : "No payment is due. Your reservation pass will be issued after confirmation."}
        </p>
      </div>
      </>}
    </div>
  );
}
