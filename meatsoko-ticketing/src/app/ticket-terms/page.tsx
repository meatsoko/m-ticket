import type { Metadata } from "next";
import Link from "next/link";
import { StoreShell } from "@/components/StoreChrome";
import { SUPPORT } from "@/lib/support";

export const metadata: Metadata = {
  title: "Ticket terms & refund policy · MeatSoko",
  description: "Terms for MeatSoko event tickets and table packages, and how refunds work.",
};

export default function TicketTermsPage() {
  return (
    <StoreShell>
      <main className="store-subpage policy-page">
        <h1>Ticket terms &amp; refund policy</h1>
        <p className="store-subpage-intro">
          For MeatSoko events, including NyamaFest. Questions? Call or WhatsApp <a href={SUPPORT.tel}>{SUPPORT.display}</a>.
        </p>

        <section>
          <h2>Your ticket</h2>
          <ul>
            <li>Every ticket is a QR code, emailed to you and shown on your pass page. It is scanned once at the gate.</li>
            <li><strong>General Admission</strong> is free and admits one person.</li>
            <li>A <strong>table package</strong> admits the number of people shown (3, 7 or 10) on one QR code, and includes the platter named. Your whole group should arrive together, or the first arrivals can be admitted and the rest join them.</li>
            <li>Keep your QR private. Anyone holding it can use it, and once it has been scanned it can’t be used again. You may pass it to someone else if you can’t attend.</li>
            <li>Entry is subject to venue capacity, security checks and the organiser’s house rules. The organiser may refuse entry to anyone behaving in an unsafe or abusive way, without a refund.</li>
          </ul>
        </section>

        <section>
          <h2>Upgrading to a table</h2>
          <p>
            You can upgrade a General Admission ticket to a table from your pass page until bookings close. You keep the same booking
            number and QR code. If a payment is cancelled or doesn’t go through, nothing changes and you keep your free ticket.
          </p>
        </section>

        <section>
          <h2>Refunds</h2>
          <ul>
            <li><strong>Table packages</strong> can be cancelled for a full refund up to <strong>7 days before the event</strong>. After that they can’t be refunded, but you can pass the ticket to someone else.</li>
            <li>Platters are prepared for the event day. They can’t be exchanged for cash or collected on another day.</li>
            <li>If you were charged twice or something went wrong with a payment, we refund the extra in full.</li>
            <li>Refunds go back to the M-Pesa number or card you paid with, for the amount paid in shillings, usually within 7 working days.</li>
            <li><strong>If the event is cancelled</strong>, every paid ticket is refunded in full. <strong>If it is postponed</strong>, your ticket is valid for the new date, or you can ask for a full refund within 14 days of the announcement.</li>
          </ul>
        </section>

        <section>
          <h2>How to ask for a refund</h2>
          <p>
            Call or WhatsApp <a href={SUPPORT.tel}>{SUPPORT.display}</a> (
            <a href={SUPPORT.whatsapp} target="_blank" rel="noopener noreferrer">chat on WhatsApp</a>) with your booking number — it is
            on your pass and in your confirmation email. Lost your pass? <Link href="/lookup">Find it here</Link>.
          </p>
          <Link href="/events" className="store-button">Back to events <span>↗</span></Link>
        </section>
      </main>
    </StoreShell>
  );
}
