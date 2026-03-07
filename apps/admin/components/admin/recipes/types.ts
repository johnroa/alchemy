export type RecipeStatusFilter = "all" | "ready" | "pending" | "failed";
export type RecipeSortOrder =
  | "updated_desc"
  | "updated_asc"
  | "title_asc"
  | "title_desc"
  | "versions_desc"
  | "saves_desc";

export const STATUS_OPTIONS: Array<{ value: RecipeStatusFilter; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "ready", label: "Ready images" },
  { value: "pending", label: "Pending images" },
  { value: "failed", label: "Failed images" }
];

export const SORT_OPTIONS: Array<{ value: RecipeSortOrder; label: string }> = [
  { value: "updated_desc", label: "Updated ↓" },
  { value: "updated_asc", label: "Updated ↑" },
  { value: "title_asc", label: "Title A-Z" },
  { value: "title_desc", label: "Title Z-A" },
  { value: "versions_desc", label: "Versions ↓" },
  { value: "saves_desc", label: "Saves ↓" }
];

export const parseStatusFilter = (value: string | undefined): RecipeStatusFilter => {
  if (value === "ready" || value === "pending" || value === "failed") {
    return value;
  }
  return "all";
};

export const parseSortOrder = (value: string | undefined): RecipeSortOrder => {
  if (
    value === "updated_asc" ||
    value === "title_asc" ||
    value === "title_desc" ||
    value === "versions_desc" ||
    value === "saves_desc"
  ) {
    return value;
  }
  return "updated_desc";
};

export const buildRecipesHref = (params: {
  q?: string;
  recipe?: string;
  status?: RecipeStatusFilter;
  sort?: RecipeSortOrder;
}): string => {
  const query = new URLSearchParams();
  if (params.q?.trim()) query.set("q", params.q.trim());
  if (params.recipe?.trim()) query.set("recipe", params.recipe.trim());
  if (params.status && params.status !== "all") query.set("status", params.status);
  if (params.sort && params.sort !== "updated_desc") query.set("sort", params.sort);
  const queryString = query.toString();
  return queryString.length > 0 ? `/content/recipes?${queryString}` : "/content/recipes";
};

export const truncate = (value: string, max = 280): string => {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
};

export const shortId = (value: string): string => {
  if (value.length < 14) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
};

export const imageStatusBadgeClass = (status: string): string => {
  if (status === "ready") return "border-emerald-300 bg-emerald-50 text-emerald-700";
  if (status === "failed") return "border-red-300 bg-red-50 text-red-700";
  return "border-amber-300 bg-amber-50 text-amber-700";
};

const normalizeAssistantReply = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    const reply = (value as { text?: unknown }).text;
    if (typeof reply === "string" && reply.trim().length > 0) return reply.trim();
  }
  return null;
};

/**
 * Extracts a human-readable preview from a chat message. For assistant messages,
 * attempts to parse the structured JSON envelope and surfaces the reply text,
 * recipe title, and/or candidate component count.
 */
export const chatMessagePreview = (role: string, content: string): string => {
  if (role !== "assistant") return truncate(content, 200);
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return truncate(content, 200);
    const envelope = parsed as {
      assistant_reply?: unknown;
      recipe?: { title?: unknown };
      candidate_recipe_set?: { components?: unknown[] };
      loop_state?: unknown;
    };
    const assistantReply = normalizeAssistantReply(envelope.assistant_reply);
    const recipeTitle = typeof envelope.recipe?.title === "string" ? envelope.recipe.title.trim() : "";
    const componentCount = Array.isArray(envelope.candidate_recipe_set?.components)
      ? envelope.candidate_recipe_set.components.length
      : 0;
    if (assistantReply && componentCount > 0) {
      return truncate(`${assistantReply} (candidate tabs: ${componentCount})`, 200);
    }
    if (assistantReply && recipeTitle) return truncate(`${assistantReply} (recipe: ${recipeTitle})`, 200);
    if (assistantReply) return truncate(assistantReply, 200);
    if (recipeTitle) return truncate(`Updated recipe: ${recipeTitle}`, 200);
  } catch {
    return truncate(content, 200);
  }
  return truncate(content, 200);
};

export const getContextLoopState = (context: Record<string, unknown> | undefined): string | null => {
  const value = context?.["loop_state"];
  return typeof value === "string" && value.length > 0 ? value : null;
};

export const getContextCandidateSummary = (context: Record<string, unknown> | undefined): { revision: number; components: number } | null => {
  const candidate = context?.["candidate_recipe_set"];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const revision = Number((candidate as { revision?: unknown }).revision);
  const components = Array.isArray((candidate as { components?: unknown[] }).components)
    ? (candidate as { components: unknown[] }).components.length
    : 0;

  return {
    revision: Number.isFinite(revision) ? Math.trunc(revision) : 0,
    components
  };
};
