#!/usr/bin/env node
/**
 * Converts openapi.yaml → openapi.json so downstream consumers (like the admin
 * API visualizer) can import the spec as plain JSON without needing a YAML parser
 * at runtime. Run via `pnpm --filter @alchemy/contracts generate:json`.
 *
 * Uses js-yaml which is available as a transitive dependency in the pnpm store.
 * We resolve it dynamically rather than listing it as a direct dependency.
 */
import { readFileSync, writeFileSync } from "fs";
import { createRequire } from "module";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractsRoot = join(__dirname, "..");

// Resolve js-yaml from the pnpm store (transitive dep of openapi-typescript)
const require = createRequire(join(contractsRoot, "node_modules", ".pnpm", "node_modules", "placeholder.js"));
let yaml;
try {
  yaml = require("js-yaml");
} catch {
  // Fallback: try from project root node_modules
  const rootRequire = createRequire(join(contractsRoot, "..", "..", "node_modules", "placeholder.js"));
  yaml = rootRequire("js-yaml");
}

const yamlPath = join(contractsRoot, "openapi.yaml");
const jsonPath = join(contractsRoot, "openapi.json");

const doc = yaml.load(readFileSync(yamlPath, "utf8"));
writeFileSync(jsonPath, JSON.stringify(doc, null, 2));
console.log("openapi.yaml → openapi.json");
