import {
  assert,
  assertEquals,
} from "jsr:@std/assert";
import {
  buildMatchedChipIds,
  buildSuggestedChips,
  mergeSemanticProfiles,
} from "./semantic-facets.ts";
import {
  normalizeRecipeSemanticProfile,
} from "../../../../packages/shared/src/recipe-semantics.ts";

Deno.test("normalizeRecipeSemanticProfile dedupes descriptors by normalized id", () => {
  const profile = normalizeRecipeSemanticProfile({
    descriptors: [
      {
        axis: "Occasion",
        key: " Weeknight ",
        label: "Weeknight",
        confidence: 0.61,
      },
      {
        axis: "occasion",
        key: "weeknight",
        label: "Weeknight",
        confidence: 0.92,
        evidence: "steps stay simple",
      },
      {
        axis: "mood",
        label: "Comfort Food",
        confidence: 0.87,
      },
    ],
  });

  assert(profile);
  assertEquals(profile.descriptors.length, 2);
  assertEquals(profile.descriptors[0], {
    id: "mood:comfort_food",
    axis: "mood",
    key: "comfort_food",
    label: "Comfort Food",
    confidence: 0.87,
  });
  assertEquals(profile.descriptors[1], {
    id: "occasion:weeknight",
    axis: "occasion",
    key: "weeknight",
    label: "Weeknight",
    confidence: 0.92,
    evidence: "steps stay simple",
  });
});

Deno.test("mergeSemanticProfiles keeps the highest-confidence descriptor for each id", () => {
  const canonical = normalizeRecipeSemanticProfile({
    descriptors: [
      {
        axis: "occasion",
        label: "Weeknight",
        confidence: 0.72,
      },
      {
        axis: "health",
        label: "Leans Healthy",
        confidence: 0.75,
      },
    ],
  });
  const overlay = normalizeRecipeSemanticProfile({
    descriptors: [
      {
        axis: "occasion",
        label: "Weeknight",
        confidence: 0.95,
      },
      {
        axis: "social_setting",
        label: "Family Style",
        confidence: 0.84,
      },
    ],
  });

  const merged = mergeSemanticProfiles(canonical, overlay);
  assert(merged);
  assertEquals(
    merged.descriptors.map((descriptor) => ({
      id: descriptor.id,
      confidence: descriptor.confidence,
    })),
    [
      { id: "health:leans_healthy", confidence: 0.75 },
      { id: "occasion:weeknight", confidence: 0.95 },
      { id: "social_setting:family_style", confidence: 0.84 },
    ],
  );
});

Deno.test("buildSuggestedChips returns broad axis coverage before repeating an axis", () => {
  const items = [
    {
      item_id: "recipe-1",
      profile: normalizeRecipeSemanticProfile({
        descriptors: [
          { axis: "occasion", label: "Weeknight", confidence: 0.93 },
          { axis: "health", label: "Healthy & Quick", confidence: 0.91 },
          { axis: "cuisine", label: "Asian Inspired", confidence: 0.86 },
        ],
      }),
    },
    {
      item_id: "recipe-2",
      profile: normalizeRecipeSemanticProfile({
        descriptors: [
          { axis: "occasion", label: "Weeknight", confidence: 0.9 },
          { axis: "social_setting", label: "Family Style", confidence: 0.88 },
          { axis: "cuisine", label: "Asian Inspired", confidence: 0.85 },
        ],
      }),
    },
    {
      item_id: "recipe-3",
      profile: normalizeRecipeSemanticProfile({
        descriptors: [
          { axis: "health", label: "Healthy & Quick", confidence: 0.89 },
          { axis: "mood", label: "Comfort Food", confidence: 0.81 },
        ],
      }),
    },
  ];

  const chips = buildSuggestedChips({ items, maxChips: 6 });

  assertEquals(
    chips.map((chip) => chip.id),
    [
      "cuisine:asian_inspired",
      "health:healthy_quick",
      "occasion:weeknight",
      "mood:comfort_food",
      "social_setting:family_style",
    ],
  );
  assertEquals(
    chips.map((chip) => chip.matched_count),
    [2, 2, 2, 1, 1],
  );
});

Deno.test("buildMatchedChipIds returns only chips present on the effective profile", () => {
  const profile = normalizeRecipeSemanticProfile({
    descriptors: [
      { axis: "occasion", label: "Weeknight", confidence: 0.95 },
      { axis: "mood", label: "Comfort Food", confidence: 0.82 },
    ],
  });

  const matched = buildMatchedChipIds({
    profile,
    chips: [
      { id: "occasion:weeknight", label: "Weeknight", matched_count: 2 },
      { id: "health:healthy_&_quick", label: "Healthy & Quick", matched_count: 1 },
      { id: "mood:comfort_food", label: "Comfort Food", matched_count: 3 },
    ],
  });

  assertEquals(matched, ["occasion:weeknight", "mood:comfort_food"]);
});
