import {
  applyThreadPreferenceOverrides,
  derivePendingPreferenceConflictFromResponse,
  mergeThreadPreferenceOverrides,
  normalizePendingPreferenceConflict,
  normalizeThreadPreferenceOverrides,
} from "./chat-preference-conflicts.ts";

const assertEqual = (actual: unknown, expected: unknown, message: string): void => {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}\nexpected: ${expectedJson}\nreceived: ${actualJson}`);
  }
};

Deno.test("normalizePendingPreferenceConflict dedupes and trims values", () => {
  const normalized = normalizePendingPreferenceConflict({
    conflicting_preferences: [" dairy-free ", "Dairy Free", ""],
    conflicting_aversions: ["anchovies", "Anchovies"],
    requested_terms: ["Ice Cream", "ice cream"],
  });

  assertEqual(
    normalized,
    {
      conflicting_preferences: ["dairy-free"],
      conflicting_aversions: ["anchovies"],
      requested_terms: ["Ice Cream"],
    },
    "pending conflict state should normalize and dedupe values",
  );
});

Deno.test("applyThreadPreferenceOverrides removes thread-local ignored restrictions", () => {
  const overridden = applyThreadPreferenceOverrides(
    {
      dietary_restrictions: ["dairy-free", "gluten-free"],
      aversions: ["anchovies", "cilantro"],
    },
    normalizeThreadPreferenceOverrides({
      ignored_dietary_restrictions: ["Dairy Free"],
      ignored_aversions: ["anchovies"],
    }),
  );

  assertEqual(
    overridden,
    {
      dietary_restrictions: ["gluten-free"],
      aversions: ["cilantro"],
    },
    "thread-local overrides should remove the ignored restriction and aversion only",
  );
});

Deno.test("mergeThreadPreferenceOverrides stores override decisions for the current thread", () => {
  const pendingConflict = derivePendingPreferenceConflictFromResponse({
    status: "pending_confirmation",
    conflicting_preferences: ["dairy-free"],
    conflicting_aversions: ["anchovies"],
    requested_terms: ["ice cream"],
  });

  const merged = mergeThreadPreferenceOverrides({
    current: {
      ignored_dietary_restrictions: ["gluten-free"],
    },
    pendingConflict,
    preferenceConflict: {
      status: "override",
    },
  });

  assertEqual(
    merged,
    {
      ignored_dietary_restrictions: ["gluten-free", "dairy-free"],
      ignored_aversions: ["anchovies"],
    },
    "override confirmations should persist as thread-local ignored preferences",
  );
});
