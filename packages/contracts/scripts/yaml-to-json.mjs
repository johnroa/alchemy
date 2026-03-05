#!/usr/bin/env node
/**
 * Converts openapi.yaml → openapi.json so downstream consumers (like the admin
 * API visualizer) can import the spec as plain JSON without needing a YAML parser
 * at runtime. Run via `pnpm --filter @alchemy/contracts generate:json`.
 *
 * Uses js-yaml from openapi-typescript's dependency graph to avoid adding a
 * duplicate direct dependency in this workspace package.
 */
import { readFileSync, realpathSync, writeFileSync } from "fs";
import { createRequire } from "module";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractsRoot = join(__dirname, "..");
const require = createRequire(import.meta.url);

const openapiTypescriptPkg = realpathSync(
  require.resolve("openapi-typescript/package.json", { paths: [contractsRoot] }),
);
const openapiTypescriptRequire = createRequire(openapiTypescriptPkg);
const yaml = openapiTypescriptRequire("js-yaml");

const yamlPath = join(contractsRoot, "openapi.yaml");
const jsonPath = join(contractsRoot, "openapi.json");

const doc = yaml.load(readFileSync(yamlPath, "utf8"));
writeFileSync(jsonPath, JSON.stringify(doc, null, 2));
console.log("openapi.yaml → openapi.json");
