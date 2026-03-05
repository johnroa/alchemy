#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();

const fail = (message) => {
  console.error(`\n[llm-guardrails] ${message}`);
  process.exit(1);
};

const read = (relativePath) => {
  const absolute = path.join(repoRoot, relativePath);
  return fs.readFileSync(absolute, "utf8");
};

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(repoRoot, full);

    if (
      rel.startsWith(".git/") ||
      rel.startsWith("node_modules/") ||
      rel.startsWith(".playwright-cli/") ||
      rel.startsWith("apps/admin/.next/")
    ) {
      continue;
    }

    if (entry.isDirectory()) {
      walk(full, out);
      continue;
    }

    out.push(rel);
  }
  return out;
};

const files = walk(repoRoot).filter((rel) => {
  return /\.(ts|tsx|js|mjs|sql|md|yaml|yml)$/.test(rel);
});

const disallowedProviderCallFiles = files.filter((rel) => {
  if (
    rel.endsWith(".md") ||
    rel.endsWith(".test.ts") ||
    rel === "scripts/check-llm-pipeline-guardrails.mjs"
  ) {
    return false;
  }

  const content = read(rel);
  if (
    !content.includes("api.openai.com") &&
    !content.includes("api.anthropic.com") &&
    !content.includes("generativelanguage.googleapis.com")
  ) {
    return false;
  }

  return !rel.startsWith("supabase/functions/_shared/llm-adapters/");
});

if (disallowedProviderCallFiles.length > 0) {
  fail(
    `Direct provider endpoint references found outside llm-adapters: ${disallowedProviderCallFiles.join(
      ", ",
    )}`,
  );
}

const registryText = read("supabase/functions/_shared/llm-scope-registry.ts");
const scopeMatches = [...registryText.matchAll(/^\s{2}([a-z_]+):\s*\{/gm)].map((m) => m[1]);
if (scopeMatches.length === 0) {
  fail("No scopes found in llm-scope-registry.ts");
}

const requiredScopes = [
  "chat",
  "chat_ideation",
  "chat_generation",
  "chat_iteration",
  "generate",
  "tweak",
  "classify",
  "ingredient_alias_normalize",
  "ingredient_phrase_split",
  "ingredient_enrich",
  "recipe_metadata_enrich",
  "ingredient_relation_infer",
  "preference_normalize",
  "equipment_filter",
  "onboarding",
  "image",
  "memory_extract",
  "memory_select",
  "memory_summarize",
  "memory_conflict_resolve",
];

for (const scope of requiredScopes) {
  if (!scopeMatches.includes(scope)) {
    fail(`Registry missing required scope: ${scope}`);
  }
}

const migrationsDir = path.join(repoRoot, "supabase/migrations");
const migrationText = fs.readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .map((name) => fs.readFileSync(path.join(migrationsDir, name), "utf8"))
  .join("\n\n");

const splitScopes = [
  "ingredient_alias_normalize",
  "ingredient_phrase_split",
  "ingredient_enrich",
  "recipe_metadata_enrich",
  "ingredient_relation_infer",
  "preference_normalize",
  "equipment_filter",
];

for (const scope of splitScopes) {
  if (!migrationText.includes(`'${scope}'`)) {
    fail(`No migration seed found for scope: ${scope}`);
  }
}

const gatewayText = read("supabase/functions/_shared/llm-gateway.ts");
for (const scope of splitScopes) {
  if (!gatewayText.includes(`scope: "${scope}"`)) {
    fail(`Gateway does not execute explicit scope: ${scope}`);
  }
}

const docsPolicyChecks = [
  "AGENTS.md",
  "CLAUDE.md",
  "codex.md",
].map((doc) => ({
  doc,
  content: read(doc),
}));

for (const { doc, content } of docsPolicyChecks) {
  if (!/all llm calls/i.test(content) || !/pipeline/i.test(content)) {
    fail(`${doc} must include policy that all LLM calls go through the pipeline`);
  }
}

console.log("[llm-guardrails] ok");
