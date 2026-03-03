import { supabase } from "@/lib/supabase";

export type RecipeIngredient = {
  name: string;
  amount: number;
  unit: string;
  preparation?: string;
  category?: string;
};

export type RecipeStep = {
  index: number;
  instruction: string;
  timer_seconds?: number;
  notes?: string;
  inline_measurements?: Array<{
    ingredient: string;
    amount: number;
    unit: string;
  }>;
};

export type RecipeMetadata = {
  vibe?: string;
  flavor_profile?: string[];
  nutrition?: {
    calories?: number;
    protein_g?: number;
    carbs_g?: number;
    fat_g?: number;
    fiber_g?: number;
    sugar_g?: number;
    sodium_mg?: number;
  };
  difficulty?: string;
  allergens?: string[];
  substitutions?: Array<{
    from: string;
    to: string;
    note?: string;
  }>;
  timing?: {
    prep_minutes?: number;
    cook_minutes?: number;
    total_minutes?: number;
  };
  cuisine_tags?: string[];
  occasion_tags?: string[];
  pairing_rationale?: string[];
  serving_notes?: string[];
  [key: string]: unknown;
};

export type AssistantReply = {
  text: string;
  tone?: string;
  emoji?: string[];
  suggested_next_actions?: string[];
  focus_summary?: string;
};

export type RecipeView = {
  id: string;
  title: string;
  description?: string;
  summary: string;
  image_url?: string | null;
  image_status?: string;
  servings: number;
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
  notes?: string;
  pairings: string[];
  metadata?: RecipeMetadata;
  emoji?: string[];
  visibility: "public" | "private";
  updated_at: string;
  attachments?: RecipeAttachment[];
  category?: string;
  version?: {
    version_id: string;
    recipe_id: string;
    parent_version_id?: string | null;
    diff_summary?: string | null;
    created_at: string;
  };
};

export type RecipeAttachment = {
  attachment_id: string;
  relation_type: string;
  position: number;
  recipe: RecipeView;
};

export type RecipeCard = {
  id: string;
  title: string;
  summary: string;
  image_url?: string;
  image_status?: string;
  category?: string;
};

export type PreferenceProfile = {
  free_form?: string | null;
  dietary_preferences: string[];
  dietary_restrictions: string[];
  skill_level: string;
  equipment: string[];
  cuisines: string[];
  aversions: string[];
  cooking_for?: string | null;
  max_difficulty: number;
  presentation_preferences: Record<string, unknown>;
};

export type DraftResponse = {
  id: string;
  messages: Array<{ id: string; role: string; content: string; created_at?: string }>;
  active_recipe?: RecipeView | null;
  assistant_reply?: AssistantReply | null;
  memory_context_ids?: string[];
};

export type OnboardingChatMessage = {
  role: "assistant" | "user";
  content: string;
  created_at?: string;
};

export type OnboardingState = {
  completed: boolean;
  progress: number;
  missing_topics: string[];
  state: Record<string, unknown>;
};

export type OnboardingChatResponse = {
  assistant_reply: AssistantReply;
  onboarding_state: OnboardingState;
  preference_updates?: Record<string, unknown>;
};

const normalizeApiBase = (raw: string | undefined): string => {
  const fallback = "https://api.cookwithalchemy.com/v1";
  const value = (raw ?? fallback).trim();

  if (!value) {
    return fallback;
  }

  const hasProtocol = /^https?:\/\//i.test(value);
  const withProtocol = hasProtocol ? value : `https://${value}`;
  const withoutTrailing = withProtocol.replace(/\/+$/, "");
  const collapsed = withoutTrailing.replace(/\/v1(?:\/v1)+$/i, "/v1");

  if (collapsed.endsWith("/v1")) {
    return collapsed;
  }

  return `${collapsed}/v1`;
};

const API_URL = normalizeApiBase(process.env["EXPO_PUBLIC_API_URL"]);

const getAccessToken = async (): Promise<string> => {
  const {
    data: { session },
    error
  } = await supabase.auth.getSession();

  if (error) {
    throw new Error(`Unable to load auth session: ${error.message}`);
  }

  if (session?.access_token) {
    return session.access_token;
  }

  const { data, error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError || !data.session?.access_token) {
    throw new Error("You are not signed in. Please sign in to continue.");
  }

  return data.session.access_token;
};

const request = async <T>(path: string, options?: RequestInit): Promise<T> => {
  const headers = new Headers(options?.headers ?? {});
  headers.set("content-type", "application/json");
  headers.set("authorization", `Bearer ${await getAccessToken()}`);

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers
  });

  if (!response.ok) {
    const text = await response.text();
    let parsedMessage: string | null = null;

    try {
      const parsed = JSON.parse(text) as {
        message?: string;
      };

      if (parsed.message) {
        parsedMessage = parsed.message;
      }
    } catch {
      // no-op
    }

    throw new Error(parsedMessage ?? text ?? "Request failed");
  }

  return (await response.json()) as T;
};

export const api = {
  getCookbook: async (): Promise<{ items: RecipeCard[] }> => {
    return request<{ items: RecipeCard[] }>("/recipes/cookbook?limit=50");
  },

  getRecipe: async (recipeId: string): Promise<RecipeView> => {
    return request<RecipeView>(`/recipes/${recipeId}`);
  },

  getRecipeHistory: async (recipeId: string): Promise<{
    recipe_id: string;
    versions: Array<{
      id: string;
      parent_version_id: string | null;
      diff_summary: string | null;
      created_at: string;
    }>;
    draft_messages: Array<{ id: string; role: string; content: string; created_at: string }>;
  }> => {
    return request(`/recipes/${recipeId}/history`);
  },

  createDraft: async (message: string): Promise<DraftResponse> => {
    return request<DraftResponse>("/recipe-drafts", {
      method: "POST",
      body: JSON.stringify({ message })
    });
  },

  continueDraft: async (draftId: string, message: string): Promise<DraftResponse> => {
    return request<DraftResponse>(`/recipe-drafts/${draftId}/messages`, {
      method: "POST",
      body: JSON.stringify({ message })
    });
  },

  getDraft: async (draftId: string): Promise<DraftResponse> => {
    return request<DraftResponse>(`/recipe-drafts/${draftId}`);
  },

  finalizeDraft: async (
    draftId: string
  ): Promise<{ recipe: RecipeView; assistant_reply?: AssistantReply | null }> => {
    return request<{ recipe: RecipeView; assistant_reply?: AssistantReply | null }>(
      `/recipe-drafts/${draftId}/finalize`,
      { method: "POST" }
    );
  },

  tweakRecipe: async (
    recipeId: string,
    message: string
  ): Promise<{ recipe: RecipeView; assistant_reply?: AssistantReply | null }> => {
    return request<{ recipe: RecipeView; assistant_reply?: AssistantReply | null }>(`/recipes/${recipeId}/tweak`, {
      method: "POST",
      body: JSON.stringify({ message })
    });
  },

  saveRecipe: async (recipeId: string): Promise<{ saved: boolean }> => {
    return request(`/recipes/${recipeId}/save`, { method: "POST" });
  },

  unsaveRecipe: async (recipeId: string): Promise<{ saved: boolean }> => {
    return request(`/recipes/${recipeId}/save`, { method: "DELETE" });
  },

  addAttachment: async (
    recipeId: string,
    payload: { relation_type: string; prompt?: string; position?: number }
  ): Promise<{ recipe: RecipeView; attachment_id: string }> => {
    return request(`/recipes/${recipeId}/attachments`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  setCategoryOverride: async (recipeId: string, category: string): Promise<{ ok: boolean }> => {
    return request(`/recipes/${recipeId}/categories/override`, {
      method: "POST",
      body: JSON.stringify({ category })
    });
  },

  getPreferences: async (): Promise<PreferenceProfile> => {
    return request("/preferences");
  },

  updatePreferences: async (payload: PreferenceProfile): Promise<PreferenceProfile> => {
    return request("/preferences", {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  },

  getMemories: async (): Promise<{
    items: Array<{
      id: string;
      memory_type: string;
      memory_kind: string;
      confidence: number;
      salience: number;
      status: string;
      updated_at: string;
    }>;
    snapshot: Record<string, unknown>;
  }> => {
    return request("/memories");
  },

  resetMemories: async (): Promise<{ ok: boolean }> => {
    return request("/memories/reset", {
      method: "POST",
      body: JSON.stringify({})
    });
  },

  getChangelog: async (): Promise<{
    items: Array<{
      id: string;
      scope: string;
      entity_type: string;
      action: string;
      request_id?: string;
      created_at: string;
    }>;
  }> => {
    return request("/changelog");
  },

  getOnboardingState: async (): Promise<OnboardingState> => {
    return request("/onboarding/state");
  },

  sendOnboardingMessage: async (payload: {
    message: string;
    transcript: OnboardingChatMessage[];
    state?: Record<string, unknown>;
  }): Promise<OnboardingChatResponse> => {
    return request("/onboarding/chat", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }
};
