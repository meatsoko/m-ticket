// Front-end-only merchandise catalogue.
//
// Prices are deliberately null until the organiser supplies them — never invent
// one. Everything that shows a price reads `priceKes` and says "Price coming soon"
// while it is null, and checkout stays closed while any bag line is unpriced.
//
// Descriptions and details describe only what is visible in the product
// photography (patches, prints, trims). Fabric, weight and fit notes belong here
// once they are known; they are not guessed.

export type MerchandiseProduct = {
  /** URL segment: /shop/<slug> */
  slug: string;
  /** Legacy id (the image filename) — kept so old /checkout?product= links resolve. */
  id: string;
  categoryId: string;
  style: string;
  name: string;
  color: string;
  image: string;
  priceKes: number | null;
  sizes: string[];
  summary: string;
  details: string[];
};

export type MerchandiseCategory = {
  id: string;
  name: string;
  description: string;
  products: MerchandiseProduct[];
};

const APPAREL_SIZES = ["S", "M", "L", "XL", "2XL"];
const ONE_SIZE = ["One size"];

type StyleSpec = { style: string; sizes: string[]; summary: string; details: string[] };

const STYLES: Record<string, StyleSpec> = {
  Hoodie: {
    style: "Hoodie",
    sizes: APPAREL_SIZES,
    summary: "A pullover hoodie for cool evenings and long gatherings, finished with the NyamaFest chest patch.",
    details: [
      "NyamaFest patch on the chest",
      "MeatSoko Ecosystem badge on the left sleeve",
      "Drawstring hood and front kangaroo pocket",
      "Ribbed cuffs and hem",
    ],
  },
  Polo: {
    style: "Polo",
    sizes: APPAREL_SIZES,
    summary: "A classic polo with tipped collar and sleeves, and the NyamaFest 2026 print across the back.",
    details: [
      "NyamaFest patch on the chest",
      "“nyamafest 2026” print across the back",
      "Contrast tipping on the collar and sleeves",
      "Sleeve patch",
    ],
  },
  "T-shirt": {
    style: "T-shirt",
    sizes: APPAREL_SIZES,
    summary: "An everyday crew-neck tee with the NyamaFest patch up front and the 2026 print on the back.",
    details: [
      "NyamaFest patch on the chest",
      "“nyamafest 2026” print across the back",
      "Sleeve patch",
      "Crew neck, short sleeves",
    ],
  },
  Cap: {
    style: "Cap",
    sizes: ONE_SIZE,
    summary: "A structured cap with a curved brim and the NyamaFest patch front and centre.",
    details: ["NyamaFest patch on the front panel", "Curved brim", "One size"],
  },
  Beanie: {
    style: "Beanie",
    sizes: ONE_SIZE,
    summary: "A rib-knit cuffed beanie with the NyamaFest patch on the turn-up.",
    details: ["NyamaFest patch on the cuff", "Rib knit with a fold-over cuff", "One size"],
  },
};

const product = (categoryId: string, style: keyof typeof STYLES, color: string, image: string): MerchandiseProduct => {
  const spec = STYLES[style];
  return {
    slug: `${color}-${spec.style}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    id: image,
    categoryId,
    style: spec.style,
    name: `NyamaFest ${spec.style}`,
    color,
    image: `/images/merchandise/${image}`,
    priceKes: null,
    sizes: spec.sizes,
    summary: spec.summary,
    details: spec.details,
  };
};

export const merchandiseCategories: MerchandiseCategory[] = [
  {
    id: "hoodies",
    name: "Hoodies",
    description: "Easy layers for cool evenings and long gatherings.",
    products: [
      product("hoodies", "Hoodie", "Green", "green-hoodie-nyamafest.png"),
      product("hoodies", "Hoodie", "White", "white-hoodie-nyamafest-small.png"),
      product("hoodies", "Hoodie", "Red", "red-hoodie-nyamafest.png"),
    ],
  },
  {
    id: "polos",
    name: "Polos",
    description: "A classic fit with a little MeatSoko character.",
    products: [
      product("polos", "Polo", "Red", "red-polo-nyamafest.png"),
      product("polos", "Polo", "White", "white-polo-nyamafest.png"),
      product("polos", "Polo", "Green", "green-polo-nyamafest-side.png"),
    ],
  },
  {
    id: "t-shirts",
    name: "T-shirts",
    description: "Everyday tees made for wherever the day takes you.",
    products: [
      product("t-shirts", "T-shirt", "White", "white-tee-nyamafest.png"),
      product("t-shirts", "T-shirt", "Green", "green-tee-nyamafest.png"),
      product("t-shirts", "T-shirt", "Red", "red-tee-nyamafest.png"),
    ],
  },
  {
    id: "headwear",
    name: "Headwear",
    description: "Caps and beanies to top off your gathering look.",
    products: [
      product("headwear", "Cap", "White", "white-cap-nyamafest.png"),
      product("headwear", "Beanie", "Green", "green-beanie-nyamafest.png"),
      product("headwear", "Cap", "Red", "red-cap-nyamafest.png"),
      product("headwear", "Cap", "Green", "green-cap-nyamafest.png"),
      product("headwear", "Beanie", "Red", "red-beanie-nyamafest.png"),
      product("headwear", "Beanie", "White", "white-beanie-nyamafest.png"),
    ],
  },
];

export const allProducts: MerchandiseProduct[] = merchandiseCategories.flatMap((c) => c.products);

export const getProduct = (slug: string) => allProducts.find((p) => p.slug === slug) ?? null;

export const getCategory = (id: string) => merchandiseCategories.find((c) => c.id === id) ?? null;

/** The same style in its other colours — rendered as colour swatches. */
export const colourSiblings = (p: MerchandiseProduct) => allProducts.filter((o) => o.style === p.style);

export const relatedProducts = (p: MerchandiseProduct, n = 4) =>
  [
    ...allProducts.filter((o) => o.categoryId !== p.categoryId && o.color === p.color),
    ...allProducts.filter((o) => o.categoryId === p.categoryId && o.slug !== p.slug),
  ].slice(0, n);

export function searchProducts(query: string, limit = 6) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return allProducts
    .filter((p) => {
      const hay = `${p.name} ${p.style} ${p.color} ${p.categoryId} merch merchandise nyamafest`.toLowerCase();
      return terms.every((t) => hay.includes(t) || hay.includes(t.replace(/s$/, "")));
    })
    .slice(0, limit);
}

export const SWATCH: Record<string, string> = { Green: "#1f6b3a", White: "#f4f2ee", Red: "#c62a33" };

export const formatKes = (n: number) => `KSh ${n.toLocaleString("en-KE")}`;

// Delivery options. Fees are null until the organiser confirms them (same rule as
// prices): checkout shows "Fee to be confirmed" and stays closed while the chosen
// option is unpriced. Pickup is genuinely free, so it is 0, not null.
export type DeliveryOption = {
  id: "pickup" | "event" | "standard" | "matatu";
  label: string;
  blurb: string;
  feeKes: number | null;
};

export const DELIVERY_OPTIONS: DeliveryOption[] = [
  { id: "event", label: "Collect at NyamaFest", blurb: "Pick up your order at the merchandise stand on event day, 17 October.", feeKes: 0 },
  { id: "pickup", label: "Pickup in Nairobi", blurb: "Collect from our Nairobi pickup point. We’ll text you when it’s ready.", feeKes: 0 },
  { id: "standard", label: "Standard delivery", blurb: "Delivered to your door. The fee depends on your area.", feeKes: null },
  { id: "matatu", label: "Matatu / Sacco", blurb: "Outside Nairobi: we send it to your chosen Sacco office for collection.", feeKes: null },
];

export const DELIVERY_ZONES = ["Nairobi CBD", "Greater Nairobi", "Major towns", "Rest of Kenya"];
