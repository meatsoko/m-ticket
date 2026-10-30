const usdPrices: Record<string, { earlyBird: number; regular: number }> = {
  "Basic Family Platter": { earlyBird: 15, regular: 20 },
  "Moderate Family Platter": { earlyBird: 35, regular: 40 },
  "Big Family Platter": { earlyBird: 50, regular: 55 },
};

// Demo branch (demo/nyamafest-kes1 — never merge): the tables are KSh 1 in the
// database for the demo, so show the real KSh price instead of the fixed USD mapping.
// Every caller falls back to KSh when this is null.
const DEMO_KES_PRICES = true;

export function familyPackageUsdPrices(name: string) {
  if (DEMO_KES_PRICES) return null;
  return usdPrices[name] ?? null;
}

export function formatUsd(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatUsdSaving(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(amount);
}
