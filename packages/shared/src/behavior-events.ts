export const BEHAVIOR_SURFACES = [
  "app",
  "explore",
  "chat",
  "cookbook",
  "recipe_detail",
  "system",
] as const;

export type BehaviorSurface = (typeof BEHAVIOR_SURFACES)[number];

export const BEHAVIOR_EVENT_DEFINITIONS = {
  app_first_open: { surface: "app", label: "App First Open" },
  app_session_started: { surface: "app", label: "App Session Started" },
  auth_completed: { surface: "app", label: "Auth Completed" },
  onboarding_started: { surface: "app", label: "Onboarding Started" },
  onboarding_completed: { surface: "app", label: "Onboarding Completed" },
  explore_impression: { surface: "explore", label: "Explore Impression" },
  explore_opened_recipe: { surface: "explore", label: "Explore Opened Recipe" },
  explore_saved_recipe: { surface: "explore", label: "Explore Saved Recipe" },
  chat_session_started: { surface: "chat", label: "Chat Session Started" },
  chat_turn_submitted: { surface: "chat", label: "Chat Turn Submitted" },
  chat_turn_resolved: { surface: "chat", label: "Chat Turn Resolved" },
  chat_iteration_requested: { surface: "chat", label: "Chat Iteration Requested" },
  chat_candidate_selected: { surface: "chat", label: "Chat Candidate Selected" },
  chat_commit_completed: { surface: "chat", label: "Chat Commit Completed" },
  cookbook_viewed: { surface: "cookbook", label: "Cookbook Viewed" },
  cookbook_search_applied: { surface: "cookbook", label: "Cookbook Search Applied" },
  cookbook_chip_applied: { surface: "cookbook", label: "Cookbook Chip Applied" },
  cookbook_recipe_opened: { surface: "cookbook", label: "Cookbook Recipe Opened" },
  cookbook_recipe_unsaved: { surface: "cookbook", label: "Cookbook Recipe Unsaved" },
  recipe_detail_opened: { surface: "recipe_detail", label: "Recipe Detail Opened" },
  recipe_detail_heartbeat: { surface: "recipe_detail", label: "Recipe Detail Heartbeat" },
  recipe_detail_closed: { surface: "recipe_detail", label: "Recipe Detail Closed" },
  recipe_saved: { surface: "recipe_detail", label: "Recipe Saved" },
  recipe_unsaved: { surface: "cookbook", label: "Recipe Unsaved" },
  recipe_cooked_inferred: { surface: "recipe_detail", label: "Recipe Cooked Inferred" },
  ingredient_substitution_applied: {
    surface: "recipe_detail",
    label: "Ingredient Substitution Applied",
  },
} as const satisfies Record<string, { surface: BehaviorSurface; label: string }>;

export type BehaviorEventType = keyof typeof BEHAVIOR_EVENT_DEFINITIONS;

export const BEHAVIOR_EVENT_TYPES = Object.keys(
  BEHAVIOR_EVENT_DEFINITIONS,
) as BehaviorEventType[];

export const isBehaviorSurface = (value: string): value is BehaviorSurface =>
  (BEHAVIOR_SURFACES as readonly string[]).includes(value);

export const isBehaviorEventType = (value: string): value is BehaviorEventType =>
  (BEHAVIOR_EVENT_TYPES as readonly string[]).includes(value);
