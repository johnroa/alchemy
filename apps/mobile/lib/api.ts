export type RecipeCard = {
  id: string;
  title: string;
  summary: string;
  image_url?: string;
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
};

const API_URL = process.env["EXPO_PUBLIC_API_URL"] ?? "https://api.cookwithalchemy.com/v1";

const request = async <T>(path: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options?.headers ?? {})
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || "Request failed");
  }

  return (await response.json()) as T;
};

export const api = {
  getExploreFeed: async (): Promise<{ items: RecipeCard[] }> => {
    return request<{ items: RecipeCard[] }>("/recipes/feed?limit=20");
  },

  getCookbook: async (): Promise<{ items: RecipeCard[] }> => {
    return request<{ items: RecipeCard[] }>("/recipes/feed?limit=20");
  },

  createDraft: async (message: string): Promise<{ id: string; messages: Array<{ id: string; role: string; content: string }> }> => {
    return request("/recipe-drafts", {
      method: "POST",
      body: JSON.stringify({ message })
    });
  },

  continueDraft: async (
    draftId: string,
    message: string
  ): Promise<{ id: string; messages: Array<{ id: string; role: string; content: string }> }> => {
    return request(`/recipe-drafts/${draftId}/messages`, {
      method: "POST",
      body: JSON.stringify({ message })
    });
  },

  finalizeDraft: async (draftId: string): Promise<{ recipe: { id: string; title: string } }> => {
    return request(`/recipe-drafts/${draftId}/finalize`, { method: "POST" });
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
  }
};
