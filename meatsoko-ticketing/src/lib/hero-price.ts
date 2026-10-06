import { familyPackageUsdPrices, formatUsd } from "@/lib/family-package-pricing";

/** A table type's included platter, as the event page reads it. */
export type HeroPlatter = {
  name: string; price_kes: number | string; compare_at_price_kes?: number | string | null; early_bird_ends_at?: string | null;
};

const earlyBird = (p: HeroPlatter, now: number) => !!p.early_bird_ends_at && now < new Date(p.early_bird_ends_at).getTime();

/**
 * The cheapest table, labelled exactly as the ticket panel prices it (same
 * rules as TableUpgrade / GetTicketsPanel: the fixed USD display mapping for
 * NyamaFest's family platters, otherwise KSh with the early-bird price until
 * it ends). "Cheapest" is by the KSh actually charged. Kept separate so the
 * hero never touches booking code.
 */
export function cheapestTableLabel(platters: HeroPlatter[], now: number): string | null {
  const priced = platters.map((p) => {
    const eb = earlyBird(p, now);
    const kes = eb || !p.compare_at_price_kes ? Number(p.price_kes) : Number(p.compare_at_price_kes);
    const usd = familyPackageUsdPrices(p.name);
    const label = usd ? formatUsd(eb ? usd.earlyBird : usd.regular).replace(/\.00$/, "") : `KSh ${kes.toLocaleString("en-KE")}`;
    return { kes, label };
  }).filter((p) => Number.isFinite(p.kes) && p.kes > 0);
  if (!priced.length) return null;
  priced.sort((a, b) => a.kes - b.kes);
  return priced[0].label;
}
