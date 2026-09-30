import type { Metadata } from "next";
import Link from "next/link";
import { StoreShell } from "@/components/StoreChrome";
import { SUPPORT } from "@/lib/support";
import { DELIVERY_ZONES } from "@/lib/merchandise";

export const metadata: Metadata = {
  title: "Delivery, returns & exchanges · MeatSoko",
  description: "How MeatSoko merchandise is delivered, and how returns, exchanges and refunds work.",
};

export default function ReturnsPage() {
  return (
    <StoreShell>
      <main className="store-subpage policy-page">
        <h1>Delivery, returns &amp; exchanges</h1>
        <p className="store-subpage-intro">
          We want you to love what you bought. If something isn’t right, here is exactly how we’ll fix it.
          Questions? Call or WhatsApp <a href={SUPPORT.tel}>{SUPPORT.display}</a>.
        </p>

        <section>
          <h2>Delivery and collection</h2>
          <ul>
            <li><strong>Collect at NyamaFest</strong> — free, from the merchandise stand on event day (17 October).</li>
            <li><strong>Collect at a MeatSoko franchise</strong> — free. We call or WhatsApp you when your order is ready and confirm which franchise.</li>
            <li><strong>Standard delivery</strong> — to your door: {DELIVERY_ZONES.map((z) => `${z.name} $${z.feeUsd}`).join(" · ")}. Usually 1–3 working days in Nairobi and 2–5 elsewhere.</li>
            <li><strong>Matatu / Sacco</strong> — $3 to your chosen Sacco office. You pay the Sacco any onward fare when you collect.</li>
          </ul>
          <p>Prices are in US dollars and charged in Kenyan shillings at checkout. Orders not collected within 30 days of the “ready” message may be cancelled and refunded, less any delivery fee.</p>
        </section>

        <section>
          <h2>Returns and exchanges</h2>
          <ul>
            <li>You have <strong>7 days</strong> from delivery or collection to ask for a return or exchange.</li>
            <li>Items must be unworn, unwashed and in their original condition, with tags and packaging.</li>
            <li><strong>Exchanges</strong> for a different size or colour are free at any MeatSoko franchise or at NyamaFest, subject to stock. If we send the replacement to you, the normal delivery fee applies.</li>
            <li><strong>Refunds</strong> go back to the M-Pesa number or card you paid with, for the amount you paid in shillings, within 7 working days of us receiving the item. The original delivery fee is not refunded unless the mistake was ours.</li>
            <li>For hygiene reasons, water bottles that have been used can’t be returned.</li>
          </ul>
        </section>

        <section>
          <h2>Faulty or wrong items</h2>
          <p>
            If an item arrives damaged or isn’t what you ordered, tell us within <strong>48 hours</strong> with a photo.
            We’ll replace it or refund you in full — including delivery — and cover the cost of getting it back to us.
          </p>
        </section>

        <section>
          <h2>Cancelling an order</h2>
          <p>You can cancel for a full refund any time before your order is dispatched or marked ready for collection.</p>
        </section>

        <section>
          <h2>How to start a return</h2>
          <p>
            Call or WhatsApp <a href={SUPPORT.tel}>{SUPPORT.display}</a> (
            <a href={SUPPORT.whatsapp} target="_blank" rel="noopener noreferrer">chat on WhatsApp</a>) with your order
            number — it starts with <strong>MS-</strong> and is in your confirmation email. We’ll tell you where to bring
            or send the item.
          </p>
          <Link href="/shop" className="store-button">Back to the shop <span>↗</span></Link>
        </section>
      </main>
    </StoreShell>
  );
}
