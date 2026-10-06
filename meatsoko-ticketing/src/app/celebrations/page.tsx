import type { Metadata } from "next";
import { StoreShell } from "@/components/StoreChrome";
import CelebrationForm from "@/components/celebrations/CelebrationForm";
import { displayFont, scriptFont } from "@/lib/fonts";
import { OCCASIONS } from "@/lib/celebrations";

export const metadata: Metadata = {
  title: "Celebrations · MeatSoko",
  description: "Birthdays, anniversaries, graduations, weddings, family days — tell us about the day and we'll plan the nyama and the setup with you.",
};

// Occasion booking (migration 20261007120000): request -> the team calls back
// with a plan and a quote. No prices on this page until the organiser sets them.
export default function CelebrationsPage({ searchParams }: { searchParams: { occasion?: string } }) {
  return (
    <StoreShell>
      <section className={`cel-hero ${displayFont.variable} ${scriptFont.variable}`}>
        <span className="cel-hero-word" aria-hidden="true">CELEBRATE</span>
        <div className="cel-hero-in">
          <span className="cel-kicker">MeatSoko Celebrations</span>
          <h1>Your day, <em>our grill.</em></h1>
          <p>Birthdays, anniversaries, graduations, weddings and family days. Tell us about the occasion — we&apos;ll plan the nyama, the grill and the setup with you.</p>
          <ul className="cel-hero-tags" aria-label="Occasions">
            {OCCASIONS.filter((o) => o.value !== "other").map((o) => <li key={o.value}>{o.label}</li>)}
          </ul>
        </div>
      </section>

      <section className="cel-body">
        <ol className="cel-how" aria-label="How it works">
          <li><b>01</b><strong>Tell us about the day</strong><span>The occasion, the date, how many people and where.</span></li>
          <li><b>02</b><strong>We call you</strong><span>We plan the food and the setup with you and send a quote.</span></li>
          <li><b>03</b><strong>Confirm and celebrate</strong><span>Follow every step on your private request page.</span></li>
        </ol>
        <CelebrationForm initialOccasion={searchParams.occasion} />
      </section>
    </StoreShell>
  );
}
