#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { execFileSync } from "node:child_process";
import { buildAdminRoutesSource, collectAdminRoutes } from "./generate-admin-routes.mjs";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const fail = (message) => {
  console.error(`\n[repo-guardrails] ${message}`);
  process.exit(1);
};

const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

const guardrailFiles = [
  ".gitignore",
  "AGENTS.md",
  "CLAUDE.md",
  "README.md",
  "codex.md",
  "package.json",
];

const stalePatterns = [
  { pattern: "apps/mobile/", reason: "stale apps/mobile reference" },
  { pattern: "@alchemy/mobile", reason: "stale @alchemy/mobile workspace reference" },
  { pattern: "host.exp.Exponent", reason: "stale Expo simulator reload script" },
  { pattern: "exp://", reason: "stale Expo dev URL" },
];

for (const file of guardrailFiles) {
  const contents = read(file);
  for (const { pattern, reason } of stalePatterns) {
    if (contents.includes(pattern)) {
      fail(`${file} still contains ${reason}: ${pattern}`);
    }
  }
}

const generatedRoutesPath = path.join(repoRoot, "apps/admin/lib/admin-routes.ts");
const generatedRoutes = fs.readFileSync(generatedRoutesPath, "utf8");
const expectedRoutes = buildAdminRoutesSource(collectAdminRoutes());
if (generatedRoutes !== expectedRoutes) {
  fail("apps/admin/lib/admin-routes.ts is out of date. Run node scripts/generate-admin-routes.mjs");
}

const trackedFiles = execFileSync("git", ["ls-files"], {
  cwd: repoRoot,
  encoding: "utf8",
}).split("\n").filter(Boolean);

const disallowedTrackedPatterns = [
  /\.tsbuildinfo$/,
  /^apps\/admin\/\.next\//,
  /^apps\/admin\/\.open-next\//,
  /^apps\/admin\/\.wrangler\//,
  /^build\//,
];

const trackedArtifacts = trackedFiles.filter((file) =>
  disallowedTrackedPatterns.some((pattern) => pattern.test(file))
);

if (trackedArtifacts.length > 0) {
  fail(`Tracked build/cache artifacts detected: ${trackedArtifacts.join(", ")}`);
}

console.log("[repo-guardrails] ok");
