const usdPrices: Record<string, { earlyBird: number; regular: number }> = {
  "Basic Family Platter": { earlyBird: 15, regular: 20 },
  "Moderate Family Platter": { earlyBird: 35, regular: 40 },
  "Big Family Platter": { earlyBird: 50, regular: 55 },
};

export function familyPackageUsdPrices(name: string) {
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
