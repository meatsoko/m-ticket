"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { useBag } from "./BagProvider";
import { DELIVERY_OPTIONS, DELIVERY_ZONES, formatPrice, type DeliveryOption } from "@/lib/merchandise";
import { looksLikeEmail, normalizePhone, PHONE_HINT } from "@/lib/phone";

// Merchandise payment is not wired to a backend yet: there is no merchandise
// order table, and the server has nothing to re-price a bag against. The form is
// complete so the flow can be reviewed end to end, but Pay stays disabled and
// says why. Flip this only once the order + Paystack initialisation exists.
const PAYMENT_CONNECTED = false;

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
  const blocker =
    subtotal == null ? "Prices for these pieces are being finalised — you’ll be able to pay as soon as they’re set."
    : option.feeUsd == null ? `The ${option.label.toLowerCase()} fee is being finalised. Choose a pickup option, or check back soon.`
    : !PAYMENT_CONNECTED ? "Online payment for merchandise opens soon."
    : null;

  const err = (k: keyof typeof errors) => touched && errors[k] ? <small className="field-error">{errors[k]}</small> : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    // Nothing is sent anywhere while `blocker` is set; see PAYMENT_CONNECTED.
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

          <button type="submit" className="store-button summary-cta" disabled={!!blocker} aria-describedby="checkout-blocker">
            {total != null ? `Pay ${formatPrice(total)}` : "Pay"} <span>→</span>
          </button>
          {blocker && <p className="summary-blocker" id="checkout-blocker">{blocker}</p>}
          <Link href="/cart" className="store-back-link">← Back to your bag</Link>
        </aside>
      </form>
    </main>
  );
}
