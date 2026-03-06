export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type ErrorEnvelope = {
  code: string;
  message: string;
  details?: Json;
  request_id: string;
};

export const API_BASE_PATH = "/v1";

export {
  resolveIngredientIconKey,
  type IngredientIconInput,
  type IngredientIconKey
} from "./ingredient-icon-key";
export { resolveIngredientSemanticIconId } from "./ingredient-semantic-icon";

export {
  SHADCN_FOOD_ICON_CATALOG,
  type ShadcnFoodIconCatalogEntry
} from "./shadcn-food-icon-catalog";
export {
  INGREDIENT_SEMANTIC_ICON_INDEX,
  type IngredientSemanticIconEntry
} from "./ingredient-semantic-icon-index";
export {
  IMAGE_SIMULATION_SCENARIOS,
  getImageSimulationScenarioById,
  type ImageSimulationScenario
} from "./image-simulation-catalog";
