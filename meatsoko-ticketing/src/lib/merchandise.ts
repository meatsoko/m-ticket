export type MerchandiseProduct = {
  id: string;
  name: string;
  color: string;
  image: string;
};

export type MerchandiseCategory = {
  id: string;
  name: string;
  description: string;
  products: MerchandiseProduct[];
};

const product = (name: string, color: string, image: string): MerchandiseProduct => ({
  id: image,
  name: `NyamaFest ${name}`,
  color,
  image: `/images/merchandise/${image}`,
});

export const merchandiseCategories: MerchandiseCategory[] = [
  {
    id: "hoodies",
    name: "Hoodies",
    description: "Easy layers for cool evenings and long gatherings.",
    products: [
      product("Hoodie", "Green", "green-hoodie-nyamafest.png"),
      product("Hoodie", "White", "white-hoodie-nyamafest-small.png"),
      product("Hoodie", "Red", "red-hoodie-nyamafest.png"),
    ],
  },
  {
    id: "polos",
    name: "Polos",
    description: "A classic fit with a little MeatSoko character.",
    products: [
      product("Polo", "Red", "red-polo-nyamafest.png"),
      product("Polo", "White", "white-polo-nyamafest.png"),
      product("Polo", "Green", "green-polo-nyamafest-side.png"),
    ],
  },
  {
    id: "t-shirts",
    name: "T-shirts",
    description: "Everyday tees made for wherever the day takes you.",
    products: [
      product("T-shirt", "White", "white-tee-nyamafest.png"),
      product("T-shirt", "Green", "green-tee-nyamafest.png"),
      product("T-shirt", "Red", "red-tee-nyamafest.png"),
    ],
  },
  {
    id: "headwear",
    name: "Headwear",
    description: "Caps and beanies to top off your gathering look.",
    products: [
      product("Cap", "White", "white-cap-nyamafest.png"),
      product("Beanie", "Green", "green-beanie-nyamafest.png"),
      product("Cap", "Red", "red-cap-nyamafest.png"),
      product("Cap", "Green", "green-cap-nyamafest.png"),
      product("Beanie", "Red", "red-beanie-nyamafest.png"),
      product("Beanie", "White", "white-beanie-nyamafest.png"),
    ],
  },
];
