import type { Metadata } from "next";
import { StoreShell } from "@/components/StoreChrome";
import InvestorForm from "@/components/InvestorForm";
import { INVESTOR_DAY, INVESTOR_VENUE } from "@/lib/investors";

export const metadata: Metadata = {
  title: "Investors · MeatSoko",
  description: `Register for the MeatSoko investors' visit on ${INVESTOR_DAY} at ${INVESTOR_VENUE}.`,
};

export default function InvestorsPage() {
  return (
    <StoreShell>
      <main className="store-subpage investor-page">
        <span className="investor-kicker">Investors&apos; visit · {INVESTOR_DAY} · {INVESTOR_VENUE}</span>
        <h1>Investors</h1>
        <p className="store-subpage-intro">
          Joining us on {INVESTOR_DAY} at {INVESTOR_VENUE}? Register yourself and the people coming
          with you. All fields are required; we&apos;ll confirm the time by email.
        </p>
        <InvestorForm />
      </main>
    </StoreShell>
  );
}
