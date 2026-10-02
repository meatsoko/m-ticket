import type { Metadata } from "next";
import { StoreShell } from "@/components/StoreChrome";
import InvestorsLanding from "@/components/InvestorsLanding";
import { INVESTOR_DAY, INVESTOR_VENUE } from "@/lib/investors";

export const metadata: Metadata = {
  title: "Investors · MeatSoko",
  description: `Invest in the MeatSoko ecosystem. Join the investors' visit on ${INVESTOR_DAY} at ${INVESTOR_VENUE}.`,
};

export default function InvestorsPage() {
  return (
    <StoreShell>
      <InvestorsLanding />
    </StoreShell>
  );
}
