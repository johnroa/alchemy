import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
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
  UnitPreference,
} from "../recipe-standardization.ts";
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
};

export type CookbookItem = Record<string, JsonValue>;

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
  recipe: RecipePayload;
};

export type CandidateRecipeSet = {
  candidate_id: string;
  revision: number;
  active_component_id: string;
  components: CandidateRecipeComponent[];
};

export type ChatSessionContext = {
  preferences?: PreferenceContext;
  memory_snapshot?: Record<string, JsonValue>;
  selected_memory_ids?: string[];
  loop_state?: ChatLoopState;
  candidate_recipe_set?: CandidateRecipeSet | null;
  candidate_revision?: number;
  active_component_id?: string | null;
  pending_preference_conflict?: PendingPreferenceConflict | null;
  thread_preference_overrides?: ThreadPreferenceOverrides | null;
};

export type ChatUiHints = {
  show_generation_animation?: boolean;
  focus_component_id?: string;
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
