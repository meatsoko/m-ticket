// Front-end-only merchandise catalogue.
//
// Prices are in US dollars, as supplied by the organiser (2026-09-29). A null
// price is deliberate: that piece has not been priced yet and must never be
// guessed — the UI says "Price coming soon", and checkout stays closed while
// any bag line is unpriced. When merchandise payment is built, the server must
// re-price from its own copy of these numbers and decide the charge currency
// (Paystack Kenya settles in KES); nothing the browser sends is trusted.
//
// Descriptions and details describe only what is visible in the product
// photography (patches, prints, trims). Fabric, weight, capacity and fit notes
// belong here once they are known; they are not guessed.

export type MerchandiseProduct = {
  /** URL segment: /shop/<slug> */
  slug: string;
  categoryId: string;
  /** Groups colourways of the same piece — they render as swatches of each other. */
  style: string;
  name: string;
  color: string;
  /** CSS background for the colour swatch. */
  swatch: string;
  image: string;
  priceUsd: number | null;
  sizes: string[];
  summary: string;
  details: string[];
  partner?: string;
  outOfStock?: boolean;
};

export type MerchandiseCategory = {
  id: string;
  name: string;
  eyebrow: string;
  description: string;
  products: MerchandiseProduct[];
};

const APPAREL_SIZES = ["S", "M", "L", "XL", "2XL"];
const ONE_SIZE = ["One size"];

const SWATCHES = {
  Green: "#1f6b3a",
  White: "#f4f2ee",
  Red: "#c62a33",
  Black: "#161616",
  Blue: "#1d4fd1",
  Khaki: "#a39276",
  Navy: "#1c2433",
  KenyaBlack: "linear-gradient(135deg, #161616 0 58%, #b8141d 58% 70%, #fff 70% 74%, #1f6b3a 74%)",
};

type Spec = Omit<MerchandiseProduct, "slug" | "categoryId" | "image" | "color" | "swatch" | "priceUsd">;

const NYAMAFEST = {
  hoodie: {
    style: "NyamaFest Hoodie", name: "NyamaFest Hoodie", sizes: APPAREL_SIZES,
    summary: "A pullover hoodie for cool evenings and long gatherings, finished with the NyamaFest chest patch.",
    details: ["NyamaFest patch on the chest", "MeatSoko Ecosystem badge on the left sleeve", "Drawstring hood and front kangaroo pocket", "Ribbed cuffs and hem"],
  },
  polo: {
    style: "NyamaFest Polo", name: "NyamaFest Polo", sizes: APPAREL_SIZES,
    summary: "A classic polo with tipped collar and sleeves, and the NyamaFest 2026 print across the back.",
    details: ["NyamaFest patch on the chest", "“nyamafest 2026” print across the back", "Contrast tipping on the collar and sleeves", "Sleeve patch"],
  },
  tee: {
    style: "NyamaFest T-shirt", name: "NyamaFest T-shirt", sizes: APPAREL_SIZES,
    summary: "An everyday crew-neck tee with the NyamaFest patch up front and the 2026 print on the back.",
    details: ["NyamaFest patch on the chest", "“nyamafest 2026” print across the back", "Sleeve patch", "Crew neck, short sleeves"],
  },
  cap: {
    style: "NyamaFest Cap", name: "NyamaFest Cap", sizes: ONE_SIZE,
    summary: "A structured cap with a curved brim and the NyamaFest patch front and centre.",
    details: ["NyamaFest patch on the front panel", "Curved brim", "One size"],
  },
  beanie: {
    style: "NyamaFest Beanie", name: "NyamaFest Beanie", sizes: ONE_SIZE,
    summary: "A rib-knit cuffed beanie with the NyamaFest patch on the turn-up.",
    details: ["NyamaFest patch on the cuff", "Rib knit with a fold-over cuff", "One size"],
  },
} satisfies Record<string, Spec>;

const BMB_HOODIE: Spec = {
  style: "BMB Hoodie", name: "BMB × MeatSoko Hoodie", sizes: APPAREL_SIZES, partner: "Brian Munyolo Boxing",
  summary: "A partnership hoodie with Brian Munyolo Boxing: the BMB mark up front and the MeatSoko Ecosystem print across the back.",
  details: ["BMB — Brian Munyolo Boxing print on the chest", "MeatSoko Ecosystem print across the back", "Drawstring hood and front kangaroo pocket", "Ribbed cuffs and hem"],
};

const make = (categoryId: string, spec: Spec, color: keyof typeof SWATCHES | string, image: string, priceUsd: number | null, over: Partial<MerchandiseProduct> = {}): MerchandiseProduct => {
  const swatch = (SWATCHES as Record<string, string>)[color] ?? "#ccc";
  return {
    ...spec,
    slug: `${color}-${spec.style.replace(/^NyamaFest /, "")}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    categoryId,
    color,
    swatch,
    image: `/images/merchandise/${image}`,
    priceUsd,
    ...over,
  };
};

export const merchandiseCategories: MerchandiseCategory[] = [
  {
    id: "hoodies", name: "Hoodies", eyebrow: "NYAMAFEST MERCHANDISE",
    description: "Easy layers for cool evenings and long gatherings.",
    products: [
      make("hoodies", NYAMAFEST.hoodie, "Green", "green-hoodie-nyamafest.png", 90),
      make("hoodies", NYAMAFEST.hoodie, "White", "white-hoodie-nyamafest-small.png", 95),
      make("hoodies", NYAMAFEST.hoodie, "Red", "red-hoodie-nyamafest.png", 95),
    ],
  },
  {
    id: "polos", name: "Polos", eyebrow: "NYAMAFEST MERCHANDISE",
    description: "A classic fit with a little MeatSoko character.",
    products: [
      make("polos", NYAMAFEST.polo, "Red", "red-polo-nyamafest.png", 19),
      make("polos", NYAMAFEST.polo, "White", "white-polo-nyamafest.png", 19),
      make("polos", NYAMAFEST.polo, "Green", "green-polo-nyamafest-side.png", 19),
      make("polos", {
        style: "Executive Polo", name: "MeatSoko Executive Polo", sizes: APPAREL_SIZES,
        summary: "A crisp white executive polo with the MeatSoko Ecosystem logo on the chest.",
        details: ["MeatSoko Ecosystem print on the chest", "Ribbed collar and button placket", "Short sleeves"],
      }, "White · Executive", "executive.png", 19.50, { slug: "executive-polo", outOfStock: true }),
    ],
  },
  {
    id: "t-shirts", name: "T-shirts", eyebrow: "NYAMAFEST MERCHANDISE",
    description: "Everyday tees made for wherever the day takes you.",
    products: [
      make("t-shirts", NYAMAFEST.tee, "White", "white-tee-nyamafest.png", 17),
      make("t-shirts", NYAMAFEST.tee, "Green", "green-tee-nyamafest.png", 17),
      make("t-shirts", NYAMAFEST.tee, "Red", "red-tee-nyamafest.png", 17),
    ],
  },
  {
    id: "headwear", name: "Headwear", eyebrow: "NYAMAFEST MERCHANDISE",
    description: "Caps and beanies to top off your gathering look.",
    products: [
      make("headwear", NYAMAFEST.cap, "White", "white-cap-nyamafest.png", 12),
      make("headwear", NYAMAFEST.beanie, "Green", "green-beanie-nyamafest.png", 12),
      make("headwear", NYAMAFEST.cap, "Red", "red-cap-nyamafest.png", 12),
      make("headwear", NYAMAFEST.cap, "Green", "green-cap-nyamafest.png", 12),
      make("headwear", NYAMAFEST.beanie, "Red", "red-beanie-nyamafest.png", 12),
      make("headwear", NYAMAFEST.beanie, "White", "white-beanie-nyamafest.png", 12),
    ],
  },
  {
    id: "workwear", name: "Overalls & dust coats", eyebrow: "MEATSOKO WORKWEAR",
    description: "Hard-wearing pieces for the people behind the grill and the counter.",
    products: [
      make("workwear", {
        style: "MeatSoko Dust Coat", name: "MeatSoko Dust Coat", sizes: APPAREL_SIZES,
        summary: "A full-length white dust coat with the MeatSoko Ecosystem patch on the chest and the full print across the back.",
        details: ["MeatSoko Ecosystem patch on the chest pocket", "“Convenient · Reliable · Sustainable” print across the back", "Notched lapel collar and button front", "Two lower patch pockets"],
      }, "White", "meatsoko-dust-coat-white.jpg", 18, { slug: "meatsoko-dust-coat" }),
      make("workwear", {
        style: "MeatSoko Overall", name: "MeatSoko Overall", sizes: APPAREL_SIZES,
        summary: "A one-piece khaki overall with the MeatSoko Ecosystem patch up front and a large print across the back.",
        details: ["MeatSoko Ecosystem patch on the chest", "Large MeatSoko Ecosystem print across the back", "Collar with a full-length front opening", "Long sleeves and a belted waist"],
      }, "Khaki", "meatsoko-overall-khaki.jpg", 22, { slug: "meatsoko-overall" }),
    ],
  },
  {
    id: "partnerships", name: "Partnerships", eyebrow: "MEATSOKO PARTNERS",
    description: "Collaborations with the people and brands we gather with.",
    products: [
      make("partnerships", BMB_HOODIE, "Black", "bmb-hoodie-black.jpg", 90, { slug: "bmb-hoodie-black" }),
      make("partnerships", {
        ...BMB_HOODIE,
        details: ["BMB — Brian Munyolo Boxing print on the chest", "Kenya flag on the right sleeve, “fuel your soul” down the left", "MeatSoko Ecosystem print across the back", "Drawstring hood and front kangaroo pocket"],
      }, "Black · Kenya edition", "bmb-hoodie-black-kenya.jpg", 90, { slug: "bmb-hoodie-black-kenya-edition", swatch: SWATCHES.KenyaBlack }),
      make("partnerships", BMB_HOODIE, "Blue", "bmb-hoodie-blue.jpg", 90, { slug: "bmb-hoodie-blue" }),
      make("partnerships", {
        style: "Fuel Your Soul Bottle", name: "Fuel Your Soul Water Bottle", sizes: ONE_SIZE,
        summary: "A slim matte water bottle from the “fuel your soul” partnership, with the CAMP · 60 days mark and the MeatSoko Ecosystem logo.",
        details: ["Matte finish with a screw-top lid", "CAMP · 60 days mark", "MeatSoko Ecosystem logo and “fuel your soul” script", "One size"],
      }, "Navy", "fuel-your-soul-bottle-wide.jpg", 23, { slug: "fuel-your-soul-water-bottle" }),
      make("partnerships", {
        style: "BMB T-shirt", name: "BMB × MeatSoko T-shirt", sizes: APPAREL_SIZES, partner: "Brian Munyolo Boxing",
        summary: "A partnership tee with Brian Munyolo Boxing: the BMB mark up front and the MeatSoko Ecosystem print on the back.",
        details: ["BMB — Brian Munyolo Boxing print on the chest", "MeatSoko Ecosystem print across the back", "Crew neck, short sleeves"],
      }, "Blue", "bmb-tee-blue.jpg", 15, { slug: "bmb-t-shirt-blue" }),
      make("partnerships", {
        style: "Hustle Game 21 Hoodie", name: "Hustle Game 21 Hoodie", sizes: APPAREL_SIZES,
        summary: "A black hoodie with the Hustle Game 21 script up front and the MeatSoko Ecosystem print across the back (Model view).",
        details: ["“Hustle Game 21” script on the chest with “They doubt the dream — right up until the jet hits the sky.”", "MeatSoko Ecosystem print across the back with “Convenient . Reliable . Sustainable”", "Drawstring hood and front kangaroo pocket", "Ribbed cuffs and hem"],
      }, "Black · Model view", "hustle-game-21-model.jpg", 20, { slug: "hustle-game-21-hoodie-model" }),
      make("partnerships", {
        style: "Hustle Game 21 Hoodie", name: "Hustle Game 21 Hoodie", sizes: APPAREL_SIZES,
        summary: "Front, side, and back views of the Hustle Game 21 hoodie showing the complete ecosystem branding.",
        details: ["Front view with Hustle Game 21 script", "Side sleeve token detail", "Back view with MeatSoko Ecosystem red/green branding"],
      }, "Black · Ecosystem views", "hustle-game-21-views.jpg", 20, { slug: "hustle-game-21-hoodie-views" }),
    ],
  },
];

export const allProducts: MerchandiseProduct[] = merchandiseCategories.flatMap((c) => c.products);

export const getProduct = (slug: string) => allProducts.find((p) => p.slug === slug) ?? null;

export const getCategory = (id: string) => merchandiseCategories.find((c) => c.id === id) ?? null;

/** The same piece in its other colourways — rendered as colour swatches. */
export const colourSiblings = (p: MerchandiseProduct) => allProducts.filter((o) => o.style === p.style);

export const relatedProducts = (p: MerchandiseProduct, n = 4) =>
  [
    ...allProducts.filter((o) => o.categoryId === p.categoryId && o.style !== p.style),
    ...allProducts.filter((o) => o.categoryId !== p.categoryId && o.color === p.color),
    ...allProducts.filter((o) => o.categoryId === p.categoryId && o.slug !== p.slug),
  ].filter((o, i, all) => o.slug !== p.slug && all.findIndex((x) => x.slug === o.slug) === i).slice(0, n);

export function searchProducts(query: string, limit = 6) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return allProducts
    .filter((p) => {
      const category = getCategory(p.categoryId)?.name ?? "";
      const hay = `${p.name} ${p.style} ${p.color} ${category} ${p.partner ?? ""} merch merchandise`.toLowerCase();
      return terms.every((t) => hay.includes(t) || hay.includes(t.replace(/s$/, "")));
    })
    .slice(0, limit);
}

export const formatPrice = (usd: number) => `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Delivery options. Fees are null until the organiser confirms them (same rule as
// prices): checkout shows "Fee to be confirmed" and stays closed while the chosen
// option is unpriced. Pickup is genuinely free, so it is 0, not null.
export type DeliveryOption = {
  id: "pickup" | "event" | "standard" | "matatu";
  label: string;
  blurb: string;
  feeUsd: number | null;
};

export const DELIVERY_OPTIONS: DeliveryOption[] = [
  { id: "event", label: "Collect at NyamaFest", blurb: "Pick up your order at the merchandise stand on event day, 17 October.", feeUsd: 0 },
  { id: "pickup", label: "Collect at a MeatSoko franchise", blurb: "Free. Collect from your nearest MeatSoko franchise — we’ll call or WhatsApp you when your order is ready and confirm where.", feeUsd: 0 },
  // Standard delivery is priced per area (DELIVERY_ZONES), so it has no single fee.
  { id: "standard", label: "Standard delivery", blurb: "Delivered to your door. The fee depends on your area.", feeUsd: null },
  { id: "matatu", label: "Matatu / Sacco", blurb: "Outside Nairobi: we send it to your chosen Sacco office for collection.", feeUsd: 3 },
];

// Must match merch_delivery_zones (migration 20260930090000): checkout charges
// the database's fee; these are for display.
export const DELIVERY_ZONES: { name: string; feeUsd: number }[] = [
  { name: "Nairobi CBD", feeUsd: 2 },
  { name: "Greater Nairobi", feeUsd: 3 },
  { name: "Major towns", feeUsd: 5 },
  { name: "Rest of Kenya", feeUsd: 7 },
];
export const STANDARD_FROM_USD = Math.min(...DELIVERY_ZONES.map((z) => z.feeUsd));
