export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type ErrorEnvelope = {
  code: string;
  message: string;
  details?: Json;
  request_id: string;
};

export const API_BASE_PATH = "/v1";

export {
  BEHAVIOR_EVENT_DEFINITIONS,
  BEHAVIOR_EVENT_TYPES,
  BEHAVIOR_SURFACES,
  isBehaviorEventType,
  isBehaviorSurface,
  type BehaviorEventType,
  type BehaviorSurface,
} from "./behavior-events";
export {
  ACQUISITION_CHANNELS,
  INSTALL_TELEMETRY_EVENT_TYPES,
  LIFECYCLE_STAGES,
  isAcquisitionChannel,
  isInstallTelemetryEventType,
  type AcquisitionChannel,
  type InstallTelemetryEvent,
  type InstallTelemetryEventType,
  type LifecycleStage,
} from "./acquisition";
export {
  FEATURE_FLAG_ENVIRONMENTS,
  FEATURE_FLAG_KEY_PATTERN,
  FEATURE_FLAG_RESOLUTION_REASONS,
  FEATURE_FLAG_TYPES,
  evaluateCompiledFeatureFlags,
  isFeatureFlagEnvironment,
  isFeatureFlagKey,
  isFeatureFlagPayload,
  isFeatureFlagType,
  normalizeFeatureFlagKey,
  type CompiledFeatureFlag,
  type FeatureFlagEnvironment,
  type FeatureFlagPayload,
  type FeatureFlagResolution,
  type FeatureFlagResolutionReason,
  type FeatureFlagType,
  type ResolveFlagsRequest,
  type ResolveFlagsResponse,
} from "./feature-flags";

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
export {
  buildSemanticDescriptorId,
  normalizeRecipeSemanticProfile,
  normalizeSemanticAxis,
  normalizeSemanticDescriptor,
  normalizeSemanticKey,
  type RecipeSemanticDescriptor,
  type RecipeSemanticProfile,
  type SuggestedChip,
} from "./recipe-semantics";
