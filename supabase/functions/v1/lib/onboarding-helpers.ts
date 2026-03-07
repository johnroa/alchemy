import type { JsonValue, OnboardingState } from "../../_shared/types.ts";
import type { PreferenceContext } from "./preferences.ts";

export const onboardingTopicKeys = [
  "skill",
  "equipment",
  "dietary",
  "presentation",
] as const;

export const extractOnboardingStateFromPreferences = (
  preferences: PreferenceContext,
): OnboardingState | null => {
  const candidate = preferences.presentation_preferences?.["onboarding_state"];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const data = candidate as Record<string, unknown>;
  const completed = Boolean(data.completed);
  const rawProgress = Number(data.progress);
  const progress = Number.isFinite(rawProgress)
    ? Math.max(0, Math.min(1, rawProgress))
    : completed
    ? 1
    : 0;
  const missingTopics = Array.isArray(data.missing_topics)
    ? data.missing_topics
      .filter((topic): topic is string => typeof topic === "string")
      .map((topic) => topic.trim())
      .filter((topic) => topic.length > 0)
    : [];
  const state =
    data.state && typeof data.state === "object" && !Array.isArray(data.state)
      ? (data.state as Record<string, JsonValue>)
      : {};

  return {
    completed,
    progress,
    missing_topics: missingTopics,
    state,
  };
};

export const deriveOnboardingStateFromPreferences = (
  preferences: PreferenceContext,
): OnboardingState => {
  const missingTopics: string[] = [];

  const hasSkill = preferences.skill_level.trim().length > 0;
  const hasEquipment = preferences.equipment.length > 0;
  const hasDietary = preferences.dietary_preferences.length > 0 ||
    preferences.dietary_restrictions.length > 0;
  const presentationPreferenceCount =
    Object.keys(preferences.presentation_preferences ?? {}).filter(
      (key) => key !== "onboarding_state",
    ).length;
  const hasPresentation = presentationPreferenceCount > 0;

  if (!hasSkill) {
    missingTopics.push("skill");
  }
  if (!hasEquipment) {
    missingTopics.push("equipment");
  }
  if (!hasDietary) {
    missingTopics.push("dietary");
  }
  if (!hasPresentation) {
    missingTopics.push("presentation");
  }

  const progress = Math.max(
    0,
    Math.min(
      1,
      (onboardingTopicKeys.length - missingTopics.length) /
        onboardingTopicKeys.length,
    ),
  );

  return {
    completed: missingTopics.length === 0,
    progress,
    missing_topics: missingTopics,
    state: {},
  };
};
