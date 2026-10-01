import type { Metadata } from "next";
import { StoreShell } from "@/components/StoreChrome";
import InvestorForm from "@/components/InvestorForm";
import { INVESTOR_DAY } from "@/lib/investors";

export const metadata: Metadata = {
  title: "Investors · MeatSoko",
  description: `Register for the MeatSoko investors' visit on ${INVESTOR_DAY}.`,
};

export default function InvestorsPage() {
  return (
    <StoreShell>
      <main className="store-subpage investor-page">
        <span className="investor-kicker">Investors&apos; visit · {INVESTOR_DAY}</span>
        <h1>Investors</h1>
        <p className="store-subpage-intro">
          Joining us on {INVESTOR_DAY}? Register yourself and the people coming with you, and we&apos;ll
          confirm the time and place by email.
        </p>
        <InvestorForm />
      </main>
    </StoreShell>
  );
}
