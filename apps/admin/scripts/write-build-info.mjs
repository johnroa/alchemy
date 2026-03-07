import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");
const outputPath = resolve(appDir, "lib", "build-info.generated.ts");

const readValue = (command, fallback) => {
  try {
    return execSync(command, {
      cwd: appDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return fallback;
  }
};

const commitSha =
  process.env.CF_PAGES_COMMIT_SHA?.slice(0, 7) ||
  process.env.GITHUB_SHA?.slice(0, 7) ||
  readValue("git rev-parse --short HEAD", "unknown");

const builtAt = new Date().toISOString();

const source = `export const BUILD_INFO = {
  commitSha: ${JSON.stringify(commitSha)},
  builtAt: ${JSON.stringify(builtAt)},
} as const;
`;

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, source, "utf8");
console.log(`[build-info] wrote ${outputPath}`);
