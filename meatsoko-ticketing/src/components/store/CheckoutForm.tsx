"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useBag } from "./BagProvider";
import { DELIVERY_OPTIONS, DELIVERY_ZONES, STANDARD_FROM_USD, formatPrice, type DeliveryOption } from "@/lib/merchandise";
import { looksLikeEmail, normalizePhone, PHONE_HINT } from "@/lib/phone";
import { createClient } from "@/lib/supabase/client";
import { invokeFn } from "@/lib/invoke";
import { openPaystackPopup } from "@/lib/paystack-popup";
import { PAYMENTS_PAUSED, PAYMENT_PAUSED_MESSAGE } from "@/lib/payments";
import { MPESA_ENABLED } from "@/lib/payhero";
import MpesaPay from "@/components/payments/MpesaPay";

// Merchandise payment goes live only when NEXT_PUBLIC_MERCH_PAYMENTS is "on" — set
// it after the merchandise migration is applied and merch-checkout is deployed
// (see supabase/migrations/20260929120000_merchandise_store.sql). Until then the
// form works end to end but Pay stays disabled and says why.
const PAYMENT_CONNECTED = process.env.NEXT_PUBLIC_MERCH_PAYMENTS === "on" && !PAYMENTS_PAUSED;
// M-Pesa through PayHero, alongside Paystack (needs merch payments switched on too).
const MPESA_CONNECTED = process.env.NEXT_PUBLIC_MERCH_PAYMENTS === "on" && MPESA_ENABLED;

// An order opened on Paystack but not yet paid (popup closed). Pressing Pay again with
// the same bag and details resumes it instead of creating a second order — which
// would hold the same stock twice. Kept below the server's 30-minute hold.
const PENDING_KEY = "merch_pending_payment";
const PENDING_MAX_MS = 25 * 60 * 1000;
type Pending = { sig: string; reference: string; accessCode: string; authorizationUrl: string; at: number };
const readPending = (sig: string): Pending | null => {
  try {
    const p: Pending = JSON.parse(window.sessionStorage.getItem(PENDING_KEY) ?? "null");
    return p && p.sig === sig && Date.now() - p.at < PENDING_MAX_MS ? p : null;
  } catch { return null; }
};
const writePending = (p: Pending | null) => {
  try { p ? window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(p)) : window.sessionStorage.removeItem(PENDING_KEY); } catch { /* private mode */ }
};

// What merch-checkout can refuse, in the buyer's words.
const CHECKOUT_ERRORS: Record<string, string> = {
  sold_out: "Sorry — one of your pieces just sold out in that size. Please update your bag.",
  unpriced: "One of your pieces doesn’t have a price yet, so it can’t be paid for online.",
  unavailable_item: "One of your pieces is no longer available. Please update your bag.",
  delivery_fee_unset: "That delivery option isn’t available online yet. Please choose a pickup option.",
  fx_unavailable: "Checkout is briefly unavailable while we update prices. Please try again shortly.",
  zone_required: "Choose your delivery area.",
  address_required: "Enter your delivery address.",
  town_required: "Enter the town you’ll collect from.",
  invalid_phone: PHONE_HINT,
  email_required: "Enter a valid email address.",
  rate_limited: "Too many attempts — please wait a few minutes and try again.",
  paystack_init_failed: "We couldn’t open the payment page. Please try again.",
  paystack_misconfigured: "Online payment is temporarily unavailable. Please try again later.",
};

type Fields = {
  firstName: string; lastName: string; phone: string; email: string;
  zone: string; street: string; town: string; sacco: string; notes: string;
};

const EMPTY: Fields = { firstName: "", lastName: "", phone: "", email: "", zone: "", street: "", town: "", sacco: "", notes: "" };

export default function CheckoutForm() {
  const { lines, subtotal, ready, clear } = useBag();
  const [f, setF] = useState<Fields>(EMPTY);
  const [delivery, setDelivery] = useState<DeliveryOption["id"]>("event");
  const [agree, setAgree] = useState(false);
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();


  const option = DELIVERY_OPTIONS.find((o) => o.id === delivery)!;
  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  const errors: Partial<Record<keyof Fields | "agree", string>> = {};
  if (f.firstName.trim().length < 2) errors.firstName = "Enter your first name";
  if (f.lastName.trim().length < 2) errors.lastName = "Enter your last name";
  if (!normalizePhone(f.phone)) errors.phone = PHONE_HINT;
  if (!looksLikeEmail(f.email)) errors.email = "Enter a valid email — your receipt goes here";
  if (delivery === "standard") {
    if (!f.zone) errors.zone = "Choose your area";
    if (f.street.trim().length < 3) errors.street = "Enter a street address or landmark";
  }
  if (delivery === "matatu" && f.town.trim().length < 2) errors.town = "Enter the town you’ll collect from";
  if (!agree) errors.agree = "Please accept the terms to continue";

  // Standard delivery is priced by area; everything else has one fee.
  const fee = delivery === "standard"
    ? DELIVERY_ZONES.find((z) => z.name === f.zone)?.feeUsd ?? null
    : option.feeUsd;
  const feeLabel = fee === 0 ? "Free" : fee != null ? formatPrice(fee) : delivery === "standard" ? "Choose your area" : "TBC";
  const total = subtotal != null && fee != null ? subtotal + fee : null;
  // Everything on the site is in US dollars. The KSh conversion happens server-side
  // at payment time (merch-checkout refreshes the rate) and is shown only by Paystack.
  const blocker =
    subtotal == null ? "Prices for these pieces are being finalised — you’ll be able to pay as soon as they’re set."
    : delivery !== "standard" && option.feeUsd == null ? `The ${option.label.toLowerCase()} fee is being finalised. Choose a pickup option, or check back soon.`
    : !PAYMENT_CONNECTED && !MPESA_CONNECTED ? PAYMENT_PAUSED_MESSAGE
    : null;

  const err = (k: keyof typeof errors) => touched && errors[k] ? <small className="field-error">{errors[k]}</small> : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setSubmitError(null);
    if (blocker || submitting || Object.keys(errors).length) return;
    setSubmitting(true);

    const payload = {
      customer: { first_name: f.firstName.trim(), last_name: f.lastName.trim(), phone: f.phone, email: f.email.trim(), notes: f.notes.trim() || null },
      delivery: { code: delivery, zone: f.zone || null, address: f.street.trim() || null, town: f.town.trim() || null, sacco: f.sacco.trim() || null },
      lines: lines.map((l) => ({ slug: l.slug, size: l.size, qty: l.qty })),
    };
    const sig = JSON.stringify(payload);

    let pending = readPending(sig);
    if (!pending) {
      const res = await invokeFn<{ authorizationUrl?: string; accessCode?: string; reference?: string }>(supabase, "merch-checkout", payload);
      if (!res.data?.authorizationUrl || !res.data.reference) {
        setSubmitting(false);
        setSubmitError(res.transportError
          ? "We couldn’t reach the payment service. Check your connection and try again."
          : CHECKOUT_ERRORS[res.errorCode ?? ""] ?? "Something went wrong starting your payment. Please try again.");
        return;
      }
      pending = { sig, reference: res.data.reference, accessCode: res.data.accessCode ?? "", authorizationUrl: res.data.authorizationUrl, at: Date.now() };
      writePending(pending);
    }

    const done = (reference: string) => { writePending(null); router.push(`/checkout/complete?reference=${encodeURIComponent(reference)}`); };
    const ref = pending.reference;
    const opened = pending.accessCode && await openPaystackPopup(pending.accessCode, {
      onSuccess: (tx) => done(tx?.reference || ref),
      // Closed without a success callback: ask the server before assuming nothing was paid.
      onCancel: async () => {
        const check = await invokeFn<{ payment_status?: string }>(supabase, "merch-order", { reference: ref });
        if (check.data?.payment_status === "paid" || check.data?.payment_status === "flagged") { done(ref); return; }
        if (check.data?.payment_status === "failed") writePending(null);   // next Pay starts a fresh order
        setSubmitting(false);
        setSubmitError("Payment window closed. Your order is held for 30 minutes — press Pay to continue.");
      },
      onError: () => window.location.assign(pending!.authorizationUrl),
    });
    // Script blocked or offline: fall back to Paystack's hosted page (returns to /checkout/complete).
    if (!opened) window.location.assign(pending.authorizationUrl);
  };

  if (!ready) return <main className="store-subpage checkout-page" />;

  if (lines.length === 0) {
    return (
      <main className="store-subpage checkout-page">
        <h1>Checkout</h1>
        <div className="store-empty-panel checkout-empty">
          <strong>Your bag is empty.</strong>
          <p>Add a piece or two, then come back here to choose delivery and pay.</p>
          <Link href="/shop" className="store-button">Explore the shop <span>↗</span></Link>
        </div>
      </main>
    );
  }

  return (
    <main className="store-subpage checkout-page">
      <h1>Checkout</h1>
      <div className="checkout-steps" aria-label="Checkout steps"><span className="done">01 &nbsp; Bag</span><span className="current">02 &nbsp; Details &amp; delivery</span><span>03 &nbsp; Payment</span></div>

      <form className="checkout-layout" onSubmit={submit} noValidate>
        <div className="checkout-main">
          <fieldset className="checkout-card">
            <legend>Contact details</legend>
            <div className="field-grid two">
              <label className="store-field"><span>First name *</span><input value={f.firstName} onChange={set("firstName")} autoComplete="given-name" />{err("firstName")}</label>
              <label className="store-field"><span>Last name *</span><input value={f.lastName} onChange={set("lastName")} autoComplete="family-name" />{err("lastName")}</label>
              <label className="store-field"><span>Phone (M-Pesa) *</span><input value={f.phone} onChange={set("phone")} inputMode="tel" autoComplete="tel" placeholder="07XX XXX XXX" />{err("phone")}</label>
              <label className="store-field"><span>Email *</span><input value={f.email} onChange={set("email")} type="email" autoComplete="email" placeholder="you@example.com" />{err("email")}</label>
            </div>
          </fieldset>

          <fieldset className="checkout-card">
            <legend>Delivery method</legend>
            <div className="delivery-options" role="radiogroup">
              {DELIVERY_OPTIONS.map((o) => (
                <label key={o.id} className={`delivery-option${delivery === o.id ? " active" : ""}`}>
                  <input type="radio" name="delivery" value={o.id} checked={delivery === o.id} onChange={() => setDelivery(o.id)} />
                  <span><strong>{o.label}</strong><small>{o.blurb}</small></span>
                  <em>{o.feeUsd === 0 ? "Free" : o.feeUsd != null ? formatPrice(o.feeUsd) : o.id === "standard" ? `From ${formatPrice(STANDARD_FROM_USD)}` : "Fee TBC"}</em>
                </label>
              ))}
            </div>

            {delivery === "standard" && (
              <div className="field-grid two delivery-fields">
                <label className="store-field"><span>Area *</span>
                  <select value={f.zone} onChange={set("zone")}><option value="">Select your area</option>{DELIVERY_ZONES.map((z) => <option key={z.name} value={z.name}>{z.name} — {formatPrice(z.feeUsd)}</option>)}</select>{err("zone")}
                </label>
                <label className="store-field"><span>Street address or landmark *</span><input value={f.street} onChange={set("street")} autoComplete="street-address" placeholder="House, street, estate" />{err("street")}</label>
              </div>
            )}
            {delivery === "matatu" && (
              <>
                <p className="delivery-notice">We send your parcel to the Sacco office you choose. You pay the Sacco any onward fare when you collect.</p>
                <div className="field-grid two delivery-fields">
                  <label className="store-field"><span>Destination town *</span><input value={f.town} onChange={set("town")} placeholder="e.g. Nakuru" />{err("town")}</label>
                  <label className="store-field"><span>Preferred Sacco (optional)</span><input value={f.sacco} onChange={set("sacco")} placeholder="e.g. Easy Coach, 2NK" /></label>
                </div>
              </>
            )}
            {delivery === "pickup" && (
              <>
                <p className="delivery-notice">{option.blurb} Bring the order confirmation we email you.</p>
                <div className="field-grid two delivery-fields">
                  <label className="store-field"><span>Nearest franchise or area (optional)</span><input value={f.town} onChange={set("town")} placeholder="e.g. Githurai, Thika Road" /></label>
                </div>
              </>
            )}
            {delivery === "event" && (
              <p className="delivery-notice">{option.blurb} Bring the order confirmation we email you.</p>
            )}
          </fieldset>

          <fieldset className="checkout-card">
            <legend>Order notes <span>(optional)</span></legend>
            <label className="store-field"><span className="sr-only">Order notes</span><textarea value={f.notes} onChange={set("notes")} rows={3} placeholder="Anything we should know about your order or delivery" /></label>
          </fieldset>
        </div>

        <aside className="order-summary checkout-summary">
          <h2>Your order</h2>
          <ul className="summary-lines">
            {lines.map((l) => (
              <li key={`${l.slug}:${l.size}`}>
                <span className="summary-thumb"><Image src={l.product.image} alt="" fill sizes="60px" /><b>{l.qty}</b></span>
                <span><strong>{l.product.name}</strong><small>{l.product.color} · {l.size}</small></span>
                <span>{l.product.priceUsd != null ? formatPrice(l.product.priceUsd * l.qty) : "TBC"}</span>
              </li>
            ))}
          </ul>
          <div className="summary-row"><span>Subtotal</span><span>{subtotal != null ? formatPrice(subtotal) : "TBC"}</span></div>
          <div className="summary-row"><span>{option.label}</span><span>{feeLabel}</span></div>
          <div className="summary-row total"><span>Total</span><strong>{total != null ? formatPrice(total) : "To be confirmed"}</strong></div>

          <div className="summary-payment">
            <strong>Pay with M-Pesa or card</strong>
            <small>{PAYMENT_CONNECTED ? "Card or M-Pesa securely on Paystack" : "M-Pesa"}{PAYMENT_CONNECTED && MPESA_CONNECTED ? ", or straight from your phone with M-Pesa." : PAYMENT_CONNECTED ? "." : " — you’ll get a prompt on your phone."}</small>
          </div>

          <label className="summary-agree">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>I agree to the <a href="/returns" target="_blank" rel="noopener">delivery &amp; returns policy</a>.</span>
          </label>
          {err("agree")}

          {/* Paystack paused but M-Pesa (PayHero) open: show only the option that works. */}
          {!(PAYMENTS_PAUSED && MPESA_CONNECTED) && (
          <button type="submit" className={`store-button summary-cta${PAYMENTS_PAUSED ? " is-paused" : ""}`} disabled={!!blocker || submitting} aria-describedby="checkout-blocker">
            {submitting ? "Opening Paystack…" : total != null ? `Pay ${formatPrice(total)}` : "Pay"} <span>→</span>
          </button>
          )}
          {MPESA_CONNECTED && !blocker && (
            <>
              {PAYMENT_CONNECTED && <div className="pay-or">or</div>}
              <MpesaPay amountKes={null} defaultPhone={f.phone}
                cta={total != null ? `Pay ${formatPrice(total)} with M-Pesa (in KSh)` : "Pay with M-Pesa"}
                body={() => {
                  setTouched(true);
                  if (Object.keys(errors).length) return null;
                  return {
                    kind: "merch",
                    customer: { first_name: f.firstName.trim(), last_name: f.lastName.trim(), phone: f.phone, email: f.email.trim(), notes: f.notes.trim() || null },
                    delivery: { code: delivery, zone: f.zone || null, address: f.street.trim() || null, town: f.town.trim() || null, sacco: f.sacco.trim() || null },
                    lines: lines.map((l) => ({ slug: l.slug, size: l.size, qty: l.qty })),
                  };
                }}
                explain={(code) => CHECKOUT_ERRORS[code ?? ""] ?? null}
                onPaid={(r) => { clear(); if (r.access_token) router.push(`/order/${r.access_token}`); }} />
            </>
          )}
          {blocker && <p className="summary-blocker" id="checkout-blocker">{blocker}</p>}
          {submitError && <p className="summary-blocker error" role="alert">{submitError}</p>}
          {!blocker && <p className="summary-rate">Prices are in US dollars. {PAYMENT_CONNECTED ? "Paystack charges" : "M-Pesa is charged"} the equivalent in Kenya shillings at today’s rate.</p>}
          <Link href="/cart" className="store-back-link">← Back to your bag</Link>
        </aside>
      </form>
    </main>
  );
}
