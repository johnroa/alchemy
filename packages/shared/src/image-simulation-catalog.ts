export type ImageSimulationScenario = {
  id: string;
  title: string;
  description: string;
  hero_ingredients: string[];
  visual_brief: string;
};

export const IMAGE_SIMULATION_SCENARIOS: readonly ImageSimulationScenario[] = [
  {
    id: "charred-miso-salmon-bowl",
    title: "Charred Miso Salmon Bowl",
    description:
      "A glossy salmon rice bowl with blistered broccolini, cucumbers, sesame rice, and a lacquered miso glaze.",
    hero_ingredients: ["salmon", "miso glaze", "sesame rice", "broccolini", "cucumber"],
    visual_brief:
      "Restaurant-style overhead hero shot, lacquered salmon with visible char, tidy bowl composition, soft daylight, warm ceramic bowl."
  },
  {
    id: "crispy-hot-honey-chicken-cutlets",
    title: "Crispy Hot Honey Chicken Cutlets",
    description:
      "Golden breaded chicken cutlets drizzled with hot honey and served with lemon, herbs, and crunchy slaw.",
    hero_ingredients: ["chicken cutlets", "hot honey", "lemon", "herb slaw", "breadcrumbs"],
    visual_brief:
      "Three-quarter plated dinner angle, crisp crunchy breading, visible honey sheen, fresh herb scatter, high texture realism."
  },
  {
    id: "green-goddess-farro-salad",
    title: "Green Goddess Farro Salad",
    description:
      "A vivid grain salad with farro, avocado, snap peas, herbs, feta, and a creamy green goddess dressing.",
    hero_ingredients: ["farro", "avocado", "snap peas", "green goddess dressing", "feta"],
    visual_brief:
      "Bright editorial lunch styling, fresh greens, glossy dressing, vibrant ingredient separation, natural linen and ceramic textures."
  },
  {
    id: "spicy-coconut-noodle-soup",
    title: "Spicy Coconut Noodle Soup",
    description:
      "A rich coconut broth with noodles, chili oil, mushrooms, herbs, and a jammy soft egg.",
    hero_ingredients: ["coconut broth", "noodles", "chili oil", "mushrooms", "soft egg"],
    visual_brief:
      "Moody close-up bowl shot, visible steam, layered garnishes, glossy broth surface, cozy but realistic restaurant presentation."
  },
  {
    id: "smash-burger-with-pickled-onions",
    title: "Smash Burger with Pickled Onions",
    description:
      "A diner-style double smash burger with melted cheese, pickled onions, shredded lettuce, and fries.",
    hero_ingredients: ["beef patties", "melted cheese", "pickled onions", "potato bun", "fries"],
    visual_brief:
      "Bold casual food photography, stacked burger with crisp edges and cheese melt, fries in frame, shallow depth of field, natural shadows."
  },
  {
    id: "roasted-tomato-burrata-pasta",
    title: "Roasted Tomato Burrata Pasta",
    description:
      "Silky pasta tossed with roasted tomatoes, burrata, basil, and chili flakes.",
    hero_ingredients: ["pasta", "roasted tomatoes", "burrata", "basil", "chili flakes"],
    visual_brief:
      "Lush Italian trattoria plating, glossy sauce cling, burrata torn open, vibrant basil contrast, warm tabletop tones."
  },
  {
    id: "sticky-gochujang-tofu-wraps",
    title: "Sticky Gochujang Tofu Wraps",
    description:
      "Lettuce wraps loaded with crispy tofu, gochujang glaze, quick pickles, herbs, and rice.",
    hero_ingredients: ["tofu", "gochujang glaze", "lettuce wraps", "quick pickles", "herbs"],
    visual_brief:
      "Dynamic handheld-style platter composition, glossy tofu, crisp lettuce edges, colorful garnish, contemporary casual restaurant feel."
  },
  {
    id: "burnt-orange-almond-cake",
    title: "Burnt Orange Almond Cake",
    description:
      "A rustic almond cake with caramelized orange slices, powdered sugar, and whipped cream.",
    hero_ingredients: ["almond cake", "caramelized orange", "powdered sugar", "whipped cream"],
    visual_brief:
      "Elegant dessert photography, golden crumb detail, glossy orange slices, restrained styling, soft afternoon light."
  }
] as const;

export const getImageSimulationScenarioById = (
  id: string,
): ImageSimulationScenario | null => {
  const normalized = id.trim();
  if (!normalized) {
    return null;
  }

  return IMAGE_SIMULATION_SCENARIOS.find((scenario) => scenario.id === normalized) ?? null;
};
