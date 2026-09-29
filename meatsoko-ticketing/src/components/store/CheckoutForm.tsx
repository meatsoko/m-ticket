"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useBag } from "./BagProvider";
import { DELIVERY_OPTIONS, DELIVERY_ZONES, formatPrice, type DeliveryOption } from "@/lib/merchandise";
import { looksLikeEmail, normalizePhone, PHONE_HINT } from "@/lib/phone";
import { createClient } from "@/lib/supabase/client";
import { invokeFn } from "@/lib/invoke";

// Merchandise payment goes live only when NEXT_PUBLIC_MERCH_PAYMENTS is "on" — set
// it after the merchandise migration is applied and merch-checkout is deployed
// (see supabase/migrations/20260929120000_merchandise_store.sql). Until then the
// form works end to end but Pay stays disabled and says why.
const PAYMENT_CONNECTED = process.env.NEXT_PUBLIC_MERCH_PAYMENTS === "on";

const formatKes = (n: number) => `KSh ${Math.round(n).toLocaleString("en-KE")}`;

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
  const { lines, subtotal, ready } = useBag();
  const [f, setF] = useState<Fields>(EMPTY);
  const [delivery, setDelivery] = useState<DeliveryOption["id"]>("event");
  const [agree, setAgree] = useState(false);
  const [touched, setTouched] = useState(false);
  const [rate, setRate] = useState<number | null>(null);
  const [rateState, setRateState] = useState<"idle" | "loading" | "ready" | "missing">("idle");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const supabase = useMemo(() => createClient(), []);

  // The rate the server will charge at; shown here so the KSh figure is never a surprise.
  useEffect(() => {
    if (!PAYMENT_CONNECTED) return;
    setRateState("loading");
    supabase.rpc("merch_current_fx").then(({ data, error }) => {
      const r = !error && Array.isArray(data) && data[0] ? Number(data[0].rate) : null;
      setRate(r && r > 0 ? r : null);
      setRateState(r && r > 0 ? "ready" : "missing");
    });
  }, [supabase]);

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

  const total = subtotal != null && option.feeUsd != null ? subtotal + option.feeUsd : null;
  // Mirrors merch_create_order(): each unit rounded to whole shillings, then summed.
  // Display only — the server recomputes, and Paystack shows the final amount.
  const totalKes = rate != null && total != null
    ? lines.reduce((sum, l) => sum + Math.round((l.product.priceUsd as number) * rate) * l.qty, 0) + Math.round((option.feeUsd as number) * rate)
    : null;
  const blocker =
    subtotal == null ? "Prices for these pieces are being finalised — you’ll be able to pay as soon as they’re set."
    : option.feeUsd == null ? `The ${option.label.toLowerCase()} fee is being finalised. Choose a pickup option, or check back soon.`
    : !PAYMENT_CONNECTED ? "Online payment for merchandise opens soon."
    : rateState === "missing" ? CHECKOUT_ERRORS.fx_unavailable
    : rateState !== "ready" ? "Getting today’s exchange rate…"
    : null;

  const err = (k: keyof typeof errors) => touched && errors[k] ? <small className="field-error">{errors[k]}</small> : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setSubmitError(null);
    if (blocker || submitting || Object.keys(errors).length) return;

    setSubmitting(true);
    const res = await invokeFn<{ authorizationUrl?: string; error?: string }>(supabase, "merch-checkout", {
      customer: { first_name: f.firstName.trim(), last_name: f.lastName.trim(), phone: f.phone, email: f.email.trim(), notes: f.notes.trim() || null },
      delivery: { code: delivery, zone: f.zone || null, address: f.street.trim() || null, town: f.town.trim() || null, sacco: f.sacco.trim() || null },
      lines: lines.map((l) => ({ slug: l.slug, size: l.size, qty: l.qty })),
    });
    if (res.data?.authorizationUrl) {
      window.location.assign(res.data.authorizationUrl);   // stays "submitting" while the page changes
      return;
    }
    setSubmitting(false);
    setSubmitError(res.transportError
      ? "We couldn’t reach the payment service. Check your connection and try again."
      : CHECKOUT_ERRORS[res.errorCode ?? ""] ?? "Something went wrong starting your payment. Please try again.");
  };

  if (!ready) return <main className="store-subpage checkout-page" />;

  if (lines.length === 0) {
    return (
      <main className="store-subpage checkout-page">
        <div className="store-breadcrumb"><Link href="/">Home</Link><span>/</span><span>Checkout</span></div>
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
      <div className="store-breadcrumb"><Link href="/">Home</Link><span>/</span><Link href="/cart">Your bag</Link><span>/</span><span>Checkout</span></div>
      <span className="store-eyebrow">MERCHANDISE CHECKOUT</span>
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
                  <em>{o.feeUsd === 0 ? "Free" : o.feeUsd != null ? formatPrice(o.feeUsd) : "Fee TBC"}</em>
                </label>
              ))}
            </div>

            {delivery === "standard" && (
              <div className="field-grid two delivery-fields">
                <label className="store-field"><span>Area *</span>
                  <select value={f.zone} onChange={set("zone")}><option value="">Select your area</option>{DELIVERY_ZONES.map((z) => <option key={z}>{z}</option>)}</select>{err("zone")}
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
            {(delivery === "pickup" || delivery === "event") && (
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
          <div className="summary-row"><span>{option.label}</span><span>{option.feeUsd === 0 ? "Free" : option.feeUsd != null ? formatPrice(option.feeUsd) : "TBC"}</span></div>
          <div className="summary-row total"><span>Total</span><strong>{total != null ? formatPrice(total) : "To be confirmed"}</strong></div>

          <div className="summary-payment">
            <strong>Pay with M-Pesa or card</strong>
            <small>You’ll complete payment securely on Paystack.</small>
          </div>

          <label className="summary-agree">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>I agree to the terms, and to the delivery &amp; returns policy.</span>
          </label>
          {err("agree")}

          {totalKes != null && (
            <div className="summary-row kes"><span>You’ll pay (KSh, today’s rate)</span><strong>{formatKes(totalKes)}</strong></div>
          )}
          <button type="submit" className="store-button summary-cta" disabled={!!blocker || submitting} aria-describedby="checkout-blocker">
            {submitting ? "Opening Paystack…" : totalKes != null ? `Pay ${formatKes(totalKes)}` : total != null ? `Pay ${formatPrice(total)}` : "Pay"} <span>→</span>
          </button>
          {blocker && <p className="summary-blocker" id="checkout-blocker">{blocker}</p>}
          {submitError && <p className="summary-blocker error" role="alert">{submitError}</p>}
          {rate != null && !blocker && <p className="summary-rate">Prices are in US dollars and charged in Kenya shillings at US$1 = KSh {rate.toFixed(2)}.</p>}
          <Link href="/cart" className="store-back-link">← Back to your bag</Link>
        </aside>
      </form>
    </main>
  );
}
