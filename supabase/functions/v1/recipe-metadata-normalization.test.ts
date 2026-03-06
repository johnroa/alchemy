import { normalizeRecipeMetadata } from "../_shared/recipe-metadata-normalization.ts";
import type { JsonValue } from "../_shared/types.ts";

const assertEqual = (actual: unknown, expected: unknown, message: string): void => {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}\nexpected: ${expectedJson}\nreceived: ${actualJson}`);
  }
};

Deno.test("normalizes canonical stats and strips legacy alias keys", () => {
  const metadata: Record<string, JsonValue> = {
    difficulty_level: "intermediate",
    health_score: "65%",
    meal_type: "Dinner",
    timing: {
      prep_minutes: 20,
      cook_minutes: 25,
    },
  };

  const normalized = normalizeRecipeMetadata({
    metadata,
    ingredientCount: 10,
    stepTimerSecondsTotal: 0,
    requireModelSignals: true,
  });

  assertEqual(normalized.issues, [], "strict normalization should accept valid model signals");
  assertEqual(normalized.metadata.difficulty, "medium", "difficulty alias should map to medium");
  assertEqual(normalized.metadata.health_score, 65, "health score should parse percent-like input");
  assertEqual(normalized.metadata.time_minutes, 45, "time should use prep+cook minutes");
  assertEqual(normalized.metadata.items, 10, "items should derive from ingredient count");
  assertEqual(normalized.metadata.course_type, "Dinner", "meal_type should map into canonical course_type");
  assertEqual((normalized.metadata as Record<string, JsonValue>).difficulty_level, undefined, "legacy difficulty alias should be stripped");
  assertEqual(normalized.metadata.quick_stats, {
    time_minutes: 45,
    difficulty: "medium",
    health_score: 65,
    items: 10,
  }, "quick_stats should use canonical stat values");
});

Deno.test("strict normalization does not invent difficulty or health scores", () => {
  const normalized = normalizeRecipeMetadata({
    metadata: undefined,
    ingredientCount: 7,
    stepTimerSecondsTotal: 0,
    requireModelSignals: true,
  });

  assertEqual(
    normalized.issues,
    ["difficulty_missing", "health_score_missing", "time_minutes_missing"],
    "strict normalization should surface missing model-only signals",
  );
  assertEqual(normalized.metadata.difficulty, undefined, "difficulty should remain unset");
  assertEqual(normalized.metadata.health_score, undefined, "health score should remain unset");
  assertEqual(normalized.metadata.quick_stats, undefined, "quick_stats should not be synthesized without complete stats");
  assertEqual(normalized.metadata.items, 7, "item count can still derive from ingredient count");
});

Deno.test("maps legacy timing and skill aliases into canonical metadata", () => {
  const metadata: Record<string, JsonValue> = {
    difficulty_level: "Hard",
    skill_required: "Intermediate",
    health: "72%",
    prep_time_minutes: 15,
    cook_time_minutes: 20,
    dietary_flags: ["High Protein", "Gluten Free"],
    equipment_required: ["Sheet Pan"],
  };

  const normalized = normalizeRecipeMetadata({
    metadata,
    ingredientCount: 6,
    stepTimerSecondsTotal: 0,
  });

  assertEqual(normalized.issues, [], "non-strict normalization should canonicalize without reporting issues");
  assertEqual(normalized.metadata.difficulty, "complex", "legacy difficulty aliases should map to canonical labels");
  assertEqual(normalized.metadata.skill_level, "Intermediate", "skill alias should map into skill_level");
  assertEqual(normalized.metadata.health_score, 72, "legacy health alias should map to health_score");
  assertEqual(normalized.metadata.time_minutes, 35, "legacy timing aliases should map into canonical time_minutes");
  assertEqual(normalized.metadata.diet_tags, ["High Protein", "Gluten Free"], "diet aliases should map to diet_tags");
  assertEqual(normalized.metadata.equipment, ["Sheet Pan"], "equipment aliases should map to canonical equipment");
  assertEqual((normalized.metadata as Record<string, JsonValue>).health, undefined, "legacy health alias should be stripped");
  assertEqual((normalized.metadata as Record<string, JsonValue>).prep_time_minutes, undefined, "legacy timing aliases should not leak");
});
