import type {
  AssistantReply,
  JsonValue,
  MemoryRecord,
  RecipePayload,
  PreferenceConflictContext,
} from "../../_shared/types.ts";
import type {
  CanonicalIngredientView,
  IngredientGroup,
} from "../recipe-standardization.ts";
import {
  normalizePendingPreferenceConflict,
  normalizeThreadPreferenceOverrides,
  type PendingPreferenceConflict,
  type ThreadPreferenceOverrides,
} from "../chat-preference-conflicts.ts";
import type { PreferenceContext } from "./preferences.ts";

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

export type ChatLoopState = "ideation" | "candidate_presented" | "iterating";
export type CandidateRecipeRole = "main" | "side" | "appetizer" | "dessert" | "drink";
export type ChatIntent = "in_scope_ideation" | "in_scope_generate" | "out_of_scope";

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

export type ChatLoopResponse = {
  id: string;
  messages: ChatMessageView[];
  loop_state: ChatLoopState;
  assistant_reply: AssistantReply | null;
  candidate_recipe_set: CandidateRecipeSet | null;
  response_context?: {
    mode?: string;
    intent?: ChatIntent;
    changed_sections?: string[];
    personalization_notes?: string[];
    preference_updates?: Record<string, JsonValue>;
    preference_conflict?: PreferenceConflictContext;
  };
  memory_context_ids: string[];
  context_version: number;
  ui_hints?: ChatUiHints;
  context?: Record<string, JsonValue>;
  created_at?: string;
  updated_at?: string;
};

export const candidateRoles: CandidateRecipeRole[] = [
  "main",
  "side",
  "appetizer",
  "dessert",
  "drink",
];

export const normalizeCandidateRole = (value: unknown): CandidateRecipeRole => {
  if (
    typeof value === "string" &&
    candidateRoles.includes(value as CandidateRecipeRole)
  ) {
    return value as CandidateRecipeRole;
  }
  return "main";
};

export const normalizeCandidateImageUrl = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

export const normalizeCandidateImageStatus = (
  value: unknown,
): "pending" | "processing" | "ready" | "failed" => {
  const normalized = typeof value === "string"
    ? value.trim().toLowerCase()
    : "";
  if (
    normalized === "pending" || normalized === "processing" ||
    normalized === "ready" || normalized === "failed"
  ) {
    return normalized;
  }
  return "pending";
};

export const normalizeCandidateRecipeSet = (
  candidate: unknown,
): CandidateRecipeSet | null => {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const raw = candidate as Record<string, unknown>;
  const rawComponents = Array.isArray(raw.components) ? raw.components : [];

  const components: CandidateRecipeComponent[] = rawComponents
    .map((component, index) => {
      if (
        !component || typeof component !== "object" || Array.isArray(component)
      ) {
        return null;
      }
      const value = component as Record<string, unknown>;
      const recipe = value.recipe;
      if (!recipe || typeof recipe !== "object" || Array.isArray(recipe)) {
        return null;
      }
      const normalizedRecipe = recipe as RecipePayload;
      if (
        typeof normalizedRecipe.title !== "string" ||
        !Array.isArray(normalizedRecipe.ingredients) ||
        !Array.isArray(normalizedRecipe.steps)
      ) {
        return null;
      }

      const componentId = typeof value.component_id === "string" &&
          value.component_id.trim().length > 0
        ? value.component_id
        : crypto.randomUUID();
      const title =
        typeof value.title === "string" && value.title.trim().length > 0
          ? value.title.trim()
          : normalizedRecipe.title;

      return {
        component_id: componentId,
        role: normalizeCandidateRole(value.role),
        title,
        image_url: normalizeCandidateImageUrl(value.image_url),
        image_status: normalizeCandidateImageStatus(value.image_status),
        recipe: normalizedRecipe,
      };
    })
    .filter((component): component is CandidateRecipeComponent =>
      component !== null
    )
    .slice(0, 3);

  if (components.length === 0) {
    return null;
  }

  const activeComponentId = typeof raw.active_component_id === "string" &&
      components.some((component) =>
        component.component_id === raw.active_component_id
      )
    ? raw.active_component_id
    : components[0].component_id;

  const revision = Number(raw.revision);
  const candidateId =
    typeof raw.candidate_id === "string" && raw.candidate_id.trim().length > 0
      ? raw.candidate_id
      : crypto.randomUUID();

  return {
    candidate_id: candidateId,
    revision: Number.isFinite(revision) && revision >= 1
      ? Math.trunc(revision)
      : 1,
    active_component_id: activeComponentId,
    components,
  };
};

export const wrapRecipeInCandidateSet = (
  recipe: RecipePayload,
  existing?: CandidateRecipeSet | null,
): CandidateRecipeSet => {
  const revision = Math.max(1, Number(existing?.revision ?? 0) + 1);
  const componentId = existing?.components?.[0]?.component_id ??
    crypto.randomUUID();

  return {
    candidate_id: existing?.candidate_id ?? crypto.randomUUID(),
    revision,
    active_component_id: componentId,
    components: [
      {
        component_id: componentId,
        role: "main",
        title: recipe.title,
        image_url: null,
        image_status: "pending",
        recipe,
      },
    ],
  };
};

export const extractChatContext = (value: unknown): ChatSessionContext => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const raw = value as Record<string, unknown>;
  return {
    ...raw as ChatSessionContext,
    pending_preference_conflict: normalizePendingPreferenceConflict(
      raw.pending_preference_conflict,
    ),
    thread_preference_overrides: normalizeThreadPreferenceOverrides(
      raw.thread_preference_overrides,
    ),
  };
};

export const toJsonValue = (value: unknown): JsonValue => {
  const serialized = JSON.stringify(value);
  if (!serialized) {
    return null;
  }
  return JSON.parse(serialized) as JsonValue;
};

export const deriveLoopState = (
  context: ChatSessionContext,
  candidateSet: CandidateRecipeSet | null,
): ChatLoopState => {
  const raw = context.loop_state;
  if (
    raw === "ideation" || raw === "candidate_presented" || raw === "iterating"
  ) {
    if (!candidateSet && raw !== "ideation") {
      return "ideation";
    }
    return raw;
  }
  return candidateSet ? "candidate_presented" : "ideation";
};
