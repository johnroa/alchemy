import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { SuggestedChip as SuggestedChipType } from "../../../../packages/shared/src/recipe-semantics.ts";
import type { AuthContext } from "../../_shared/auth.ts";
import type { ModelOverrideMap } from "../../_shared/llm-gateway.ts";
import type {
  AssistantReply,
  JsonValue,
  MemoryRecord,
  PreferenceConflictContext,
  RecipePayload,
} from "../../_shared/types.ts";
import type {
  CanonicalIngredientView,
  GroupByPreference,
  IngredientGroup,
  InstructionVerbosity,
  TemperatureUnitPreference,
  UnitPreference,
} from "../recipe-standardization.ts";
import type { RecipePreview, RecipeQuickStats } from "../recipe-preview.ts";
import type {
  PendingPreferenceConflict,
  ThreadPreferenceOverrides,
} from "../chat-preference-conflicts.ts";

export type RouteContext = {
  request: Request;
  url: URL;
  segments: string[];
  method: string;
  requestId: string;
  auth: AuthContext;
  client: SupabaseClient;
  serviceClient: SupabaseClient;
  respond: (status: number, body: unknown) => Response;
  modelOverrides?: ModelOverrideMap;
};

export type RouteHandler = (
  context: RouteContext,
) => Promise<Response | null>;

export type PreferenceContext = {
  free_form: string | null;
  dietary_preferences: string[];
  dietary_restrictions: string[];
  skill_level: string;
  equipment: string[];
  cuisines: string[];
  aversions: string[];
  cooking_for: string | null;
  max_difficulty: number;
  presentation_preferences: Record<string, JsonValue>;
};

export type ContextPack = {
  preferences: PreferenceContext;
  preferencesNaturalLanguage: Record<string, JsonValue>;
  memorySnapshot: Record<string, JsonValue>;
  selectedMemories: MemoryRecord[];
  selectedMemoryIds: string[];
};

export type ChatMessageView = {
  id: string;
  role: string;
  content: string;
  metadata?: Record<string, JsonValue>;
  created_at: string;
};

export type RecipeAttachmentView = {
  attachment_id: string;
  relation_type: string;
  position: number;
  recipe: RecipeView;
};

export type RecipeView = {
  id: string;
  title: string;
  description?: string;
  summary: string;
  servings: number;
  ingredients: CanonicalIngredientView[];
  steps: RecipePayload["steps"];
  ingredient_groups?: IngredientGroup[];
  notes?: string;
  pairings: string[];
  metadata?: JsonValue;
  emoji: string[];
  image_url: string | null;
  image_status: string;
  visibility: string;
  updated_at: string;
  version: {
    version_id: string;
    recipe_id: string;
    parent_version_id: string | null;
    diff_summary: string | null;
    created_at: string;
  };
  attachments: RecipeAttachmentView[];
};

export type RecipeViewOptions = {
  units: UnitPreference;
  groupBy: GroupByPreference;
  inlineMeasurements: boolean;
  verbosity: InstructionVerbosity;
  temperatureUnit: TemperatureUnitPreference;
};

export type { RecipePreview, RecipeQuickStats };

/**
 * Variant lifecycle state. Tracks where a user's private variant sits in the
 * materialisation pipeline.
 * - current: variant is up to date with user's constraint preferences
 * - stale: constraint preferences changed; needs re-personalisation
 * - processing: re-personalisation is in progress
 * - failed: re-personalisation failed (retryable)
 * - needs_review: manual edits conflict with new constraints
 * - none: no variant exists (user sees canonical)
 */
export type VariantStatus =
  | "current"
  | "stale"
  | "processing"
  | "failed"
  | "needs_review"
  | "none";

export type ChatCommitRecipe = {
  component_id: string;
  role: CandidateRecipeRole;
  title: string;
  cookbook_entry_id: string;
  recipe_id: string | null;
  recipe_version_id: string | null;
  variant_id: string | null;
  variant_version_id: string | null;
  variant_status: VariantStatus;
  canonical_status: "pending" | "processing" | "ready" | "failed";
};

export type ChatCommitLink = {
  id: string;
  parent_recipe_id: string;
  child_recipe_id: string;
  relation_type: string;
  position: number;
};

export type ChatCommitSummary = {
  candidate_id: string;
  revision: number;
  committed_count: number;
  recipes: ChatCommitRecipe[];
  links: ChatCommitLink[];
  post_save_options: string[];
};

export type ChatCommitClaim = {
  candidate_id: string;
  revision: number;
  request_id: string;
  claimed_at: string;
};

export type ChatCommittedCandidateRecord = {
  candidate_id: string;
  revision: number;
  committed_at: string;
  commit: ChatCommitSummary;
};

export type PreferenceEditingIntent = {
  key: string;
  title?: string | null;
  prompt?: string | null;
  summary?: string | null;
  propagation?: "retroactive" | "forward_only" | "none" | null;
  system_image?: string | null;
};

/**
 * Structured tag set computed from a variant's personalized content.
 * Multi-dimensional: cuisine, dietary, technique, occasion, time,
 * difficulty, and key ingredients. Empty object `{}` when no variant
 * exists. Re-computed on every variant materialization.
 */
export type VariantTagSet = {
  cuisine?: string[];
  dietary?: string[];
  technique?: string[];
  occasion?: string[];
  time_minutes?: number | null;
  difficulty?: string | null;
  key_ingredients?: string[];
};

export type SuggestedChip = SuggestedChipType;

/**
 * A cookbook entry as returned by GET /recipes/cookbook. Includes canonical
 * recipe preview data plus variant status. When a variant exists, summary
 * and tags reflect the personalised version; title always stays canonical.
 */
export type CookbookEntry = {
  id: string;
  canonical_recipe_id: string | null;
  recipe_id: string | null;
  canonical_status: "pending" | "processing" | "ready" | "failed";
  title: string;
  summary: string;
  image_url: string | null;
  image_status: string;
  category: string | null;
  visibility: string;
  updated_at: string;
  quick_stats: RecipeQuickStats | null;
  variant_status: VariantStatus;
  active_variant_version_id: string | null;
  personalized_at: string | null;
  autopersonalize: boolean;
  saved_at: string;
  variant_tags: VariantTagSet;
  matched_chip_ids: string[];
};

export type CookbookRecipeDetail = {
  cookbook_entry_id: string;
  canonical_recipe_id: string | null;
  canonical_status: "pending" | "processing" | "ready" | "failed";
  variant_id: string | null;
  variant_version_id: string | null;
  recipe: RecipeView;
  adaptation_summary: string;
  variant_status: VariantStatus;
  derivation_kind: string | null;
  personalized_at: string | null;
  substitution_diffs: JsonValue;
  provenance?: Record<string, JsonValue>;
};

/** @deprecated Use CookbookEntry instead. Kept for backward compat during migration. */
export type CookbookItem = RecipePreview;

/**
 * Structured preference update extracted from a chat turn. iOS uses these
 * to synthesise inline "Preferences updated" system cards in the chat thread.
 */
export type PreferenceUpdate = {
  field: string;
  action: "added" | "removed" | "updated";
  value: string;
  category: "constraint" | "preference" | "rendering";
};

export type ChatLoopState = "ideation" | "candidate_presented" | "iterating";
export type CandidateRecipeRole =
  | "main"
  | "side"
  | "appetizer"
  | "dessert"
  | "drink";
export type ChatIntent =
  | "in_scope_ideation"
  | "in_scope_generate"
  | "out_of_scope";

export type CandidateRecipeComponent = {
  component_id: string;
  role: CandidateRecipeRole;
  title: string;
  image_url: string | null;
  image_status: "pending" | "processing" | "ready" | "failed";
  recipe: RecipePayload;
};

export type CandidateRecipeSet = {
  candidate_id: string;
  revision: number;
  active_component_id: string;
  components: CandidateRecipeComponent[];
};

export type PromptThreadMessage = {
  role: string;
  content: string;
};

export type DeferredGenerationContext = {
  prompt: string;
  thread: PromptThreadMessage[];
  compact_chat_context: Record<string, JsonValue>;
  candidate_recipe_set_outline?: JsonValue;
  preferences: PreferenceContext;
  memory_snapshot: Record<string, JsonValue>;
  selected_memories: MemoryRecord[];
  selected_memory_ids: string[];
};

export type ChatSessionContext = {
  preferences?: PreferenceContext;
  memory_snapshot?: Record<string, JsonValue>;
  selected_memory_ids?: string[];
  loop_state?: ChatLoopState;
  candidate_recipe_set?: CandidateRecipeSet | null;
  candidate_revision?: number;
  active_component_id?: string | null;
  active_commit?: ChatCommitClaim | null;
  last_committed_candidate?: ChatCommittedCandidateRecord | null;
  pending_preference_conflict?: PendingPreferenceConflict | null;
  thread_preference_overrides?: ThreadPreferenceOverrides | null;
  workflow?: "preferences" | null;
  entry_surface?: string | null;
  preference_editing_intent?: PreferenceEditingIntent | null;
  generation_pending?: boolean;
  deferred_generation_context?: DeferredGenerationContext | null;
};

export type ChatUiHints = {
  show_generation_animation?: boolean;
  focus_component_id?: string;
  generation_pending?: boolean;
};

export type ChatResponseContext = {
  mode?: string;
  intent?: ChatIntent;
  changed_sections?: string[];
  personalization_notes?: string[];
  preference_updates?: Record<string, JsonValue>;
  preference_conflict?: PreferenceConflictContext;
};

export type ChatLoopResponse = {
  id: string;
  messages: ChatMessageView[];
  loop_state: ChatLoopState;
  assistant_reply: AssistantReply | null;
  candidate_recipe_set: CandidateRecipeSet | null;
  response_context?: ChatResponseContext;
  memory_context_ids: string[];
  context_version: number;
  ui_hints?: ChatUiHints;
  context?: Record<string, JsonValue>;
  created_at?: string;
  updated_at?: string;
};
