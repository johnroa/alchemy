#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const apiBase = (process.env.API_URL ?? "https://api.cookwithalchemy.com/v1").replace(/\/+$/, "");
const requestedCohorts = (process.env.AUDIT_COHORTS ?? "neutral,restriction_conflict")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const casesPerCohort = Math.max(1, Number(process.env.AUDIT_CASES_PER_COHORT ?? 6));

const resolveBearerToken = () => {
  if (process.env.API_BEARER_TOKEN?.trim()) {
    return process.env.API_BEARER_TOKEN.trim();
  }

  const result = spawnSync("./scripts/admin-api.sh", ["sim-token"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || "Could not resolve sim token via admin-api.sh sim-token");
  }
  const token = result.stdout.trim();
  if (!token || token === "FAILED") {
    throw new Error("admin-api.sh sim-token did not return a usable bearer token");
  }
  return token;
};

const bearerToken = resolveBearerToken();

const request = async (pathname, options = {}) => {
  const response = await fetch(`${apiBase}${pathname}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${bearerToken}`,
      ...(options.headers ?? {}),
    },
  });

  const bodyText = await response.text();
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = bodyText;
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${pathname}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
  }

  return body;
};

const hasCanonicalQuickStats = (recipe) => {
  const metadata = recipe?.metadata ?? null;
  const quickStats = metadata?.quick_stats ?? null;
  return Boolean(
    metadata &&
      typeof metadata.difficulty === "string" &&
      Number.isInteger(metadata.health_score) &&
      Number.isInteger(metadata.time_minutes) &&
      Number.isInteger(metadata.items) &&
      quickStats &&
      Number.isInteger(quickStats.time_minutes) &&
      typeof quickStats.difficulty === "string" &&
      Number.isInteger(quickStats.health_score) &&
      Number.isInteger(quickStats.items),
  );
};

const buildImmediateRecipeSummary = (response) => {
  const component = Array.isArray(response.candidate_recipe_set?.components)
    ? response.candidate_recipe_set.components[0]
    : null;
  const recipe = component?.recipe ?? response.recipe ?? null;
  return {
    has_candidate: Boolean(component),
    has_recipe: Boolean(recipe),
    has_canonical_quick_stats: hasCanonicalQuickStats(recipe),
    difficulty: recipe?.metadata?.difficulty ?? null,
    health_score: recipe?.metadata?.health_score ?? null,
    time_minutes: recipe?.metadata?.time_minutes ?? null,
    items: recipe?.metadata?.items ?? null,
  };
};

const neutralPromptTemplates = [
  "Make a weeknight lemon chicken dinner for 2 in under 35 minutes.",
  "Create a salmon rice bowl with crunchy vegetables and a clean sauce.",
  "Generate a cozy vegetarian pasta bake with real technique and good texture.",
  "Make a high-protein turkey meatball dinner with a green side.",
  "Create a mushroom risotto that still feels practical for home cooks.",
  "Make a shrimp taco dinner with a bright slaw and balanced heat.",
];

const conflictPromptTemplates = [
  "Make classic vanilla ice cream.",
  "I want fettuccine Alfredo tonight.",
  "Generate a burrata gnocchi dinner.",
  "Make a halloumi grain bowl.",
  "Create a creamy mac and cheese.",
  "I want parmesan risotto.",
];

const buildCases = (templates, count, mapper) =>
  Array.from({ length: count }, (_, index) => mapper(templates[index % templates.length], index));

const PERSONA_PROFILES = {
  neutral: {
    preferencePatch: {
      dietary_preferences: [],
      dietary_restrictions: [],
      aversions: [],
      skill_level: "intermediate",
      max_difficulty: 3,
    },
    cases: buildCases(neutralPromptTemplates, casesPerCohort, (prompt, index) => ({
      id: `neutral-${index + 1}`,
      prompt,
      expects_conflict: false,
      follow_up: "Generate it now.",
    })),
  },
  restriction_conflict: {
    preferencePatch: {
      dietary_preferences: ["high-protein"],
      dietary_restrictions: ["dairy-free"],
      aversions: [],
      skill_level: "intermediate",
      max_difficulty: 2,
    },
    cases: buildCases(conflictPromptTemplates, casesPerCohort, (prompt, index) => ({
      id: `restriction-conflict-${index + 1}`,
      prompt,
      expects_conflict: true,
      resolution: index % 2 === 0 ? "adapt" : "override",
      follow_up: index % 2 === 0
        ? "Keep the same dish, but adapt it so it stays dairy-free."
        : "Ignore dairy-free for this chat and make the original version.",
    })),
  },
};

const runNeutralCase = async (testCase) => {
  const start = await request("/chat", {
    method: "POST",
    body: JSON.stringify({ message: testCase.prompt }),
  });
  const initial = {
    loop_state: start.loop_state ?? null,
    intent: start.response_context?.intent ?? null,
    mode: start.response_context?.mode ?? null,
    ...buildImmediateRecipeSummary(start),
  };

  let followUp = null;
  if (!initial.has_candidate && initial.intent === "in_scope_generate") {
    const generated = await request(`/chat/${start.id}/messages`, {
      method: "POST",
      body: JSON.stringify({ message: testCase.follow_up }),
    });
    followUp = {
      loop_state: generated.loop_state ?? null,
      intent: generated.response_context?.intent ?? null,
      mode: generated.response_context?.mode ?? null,
      ...buildImmediateRecipeSummary(generated),
    };
  }

  return {
    case_id: testCase.id,
    prompt: testCase.prompt,
    initial,
    follow_up: followUp,
  };
};

const runConflictCase = async (testCase) => {
  const start = await request("/chat", {
    method: "POST",
    body: JSON.stringify({ message: testCase.prompt }),
  });
  const confirmationObserved = start.response_context?.mode === "preference_conflict" &&
    !start.candidate_recipe_set;

  const confirmation = {
    loop_state: start.loop_state ?? null,
    intent: start.response_context?.intent ?? null,
    mode: start.response_context?.mode ?? null,
    confirmation_observed: confirmationObserved,
    preference_conflict: start.response_context?.preference_conflict ?? null,
    suggested_next_actions: start.assistant_reply?.suggested_next_actions ?? [],
  };

  let resolution = null;
  if (confirmationObserved) {
    const generated = await request(`/chat/${start.id}/messages`, {
      method: "POST",
      body: JSON.stringify({ message: testCase.follow_up }),
    });
    resolution = {
      loop_state: generated.loop_state ?? null,
      intent: generated.response_context?.intent ?? null,
      mode: generated.response_context?.mode ?? null,
      preference_conflict: generated.response_context?.preference_conflict ?? null,
      ...buildImmediateRecipeSummary(generated),
    };
  }

  return {
    case_id: testCase.id,
    prompt: testCase.prompt,
    resolution_type: testCase.resolution,
    confirmation,
    resolution,
  };
};

const main = async () => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputDir = path.join(repoRoot, "build", "recipe-audits", timestamp);
  await fs.mkdir(outputDir, { recursive: true });

  const originalPreferences = await request("/preferences");
  const report = {
    started_at: new Date().toISOString(),
    api_base: apiBase,
    cohorts: [],
  };

  try {
    for (const cohortName of requestedCohorts) {
      const profile = PERSONA_PROFILES[cohortName];
      if (!profile) {
        throw new Error(`Unknown audit cohort: ${cohortName}`);
      }

      await request("/preferences", {
        method: "PATCH",
        body: JSON.stringify(profile.preferencePatch),
      });

      const results = [];
      for (const testCase of profile.cases) {
        results.push(
          cohortName === "restriction_conflict"
            ? await runConflictCase(testCase)
            : await runNeutralCase(testCase),
        );
      }

      report.cohorts.push({
        name: cohortName,
        preference_patch: profile.preferencePatch,
        results,
      });
    }
  } finally {
    await request("/preferences", {
      method: "PATCH",
      body: JSON.stringify(originalPreferences),
    });
  }

  report.completed_at = new Date().toISOString();
  const outputFile = path.join(outputDir, "audit.json");
  await fs.writeFile(outputFile, JSON.stringify(report, null, 2));
  console.log(outputFile);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
