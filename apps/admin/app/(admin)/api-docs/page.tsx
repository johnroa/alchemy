import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { PageHeader } from "@/components/admin/page-header";
import { ApiVisualizer } from "@/components/admin/api-visualizer";

/**
 * Reads the OpenAPI spec JSON from the contracts package. This file is generated
 * from openapi.yaml via `pnpm --filter @alchemy/contracts generate:json`.
 * Because this is a server component, the spec is read at render time — any
 * updates to the spec are reflected on next page load / rebuild.
 */
function loadOpenApiSpec(): Record<string, unknown> {
  const specPath = join(process.cwd(), "..", "..", "packages", "contracts", "openapi.json");
  const raw = readFileSync(specPath, "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

/** HTTP methods we look for in Next.js route handler exports */
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

interface AdminRoute {
  path: string;
  method: string;
}

/**
 * Scans the admin API route directory tree to discover all route.ts files.
 * Reads each file to find exported HTTP method handlers (GET, POST, etc.)
 * and derives the URL path from the filesystem path.
 */
function discoverAdminRoutes(): AdminRoute[] {
  const apiRoot = join(process.cwd(), "app", "api", "admin");
  const routes: AdminRoute[] = [];

  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry === "route.ts" || entry === "route.tsx") {
        const relDir = relative(apiRoot, dir);
        /* Build the URL path from the filesystem path, converting Next.js
         * dynamic segments like [id] to :id for display */
        const urlPath = "/api/admin/" + relDir
          .replace(/\\/g, "/")
          .replace(/\[([^\]]+)\]/g, ":$1");

        const content = readFileSync(full, "utf8");
        for (const method of HTTP_METHODS) {
          /* Match both `export async function GET` and `export const GET =` */
          const pattern = new RegExp(`export\\s+(async\\s+)?function\\s+${method}\\b|export\\s+const\\s+${method}\\s*=`);
          if (pattern.test(content)) {
            routes.push({ path: urlPath, method });
          }
        }
      }
    }
  }

  walk(apiRoot);
  /* Sort alphabetically by path, then by method within the same path */
  routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  return routes;
}

export default function ApiDocsPage(): React.JSX.Element {
  const spec = loadOpenApiSpec();
  const adminRoutes = discoverAdminRoutes();

  return (
    <div className="space-y-6">
      <PageHeader
        title="API Reference"
        description="Auto-generated from the OpenAPI specification and admin route handlers"
      />
      <ApiVisualizer spec={spec} adminRoutes={adminRoutes} />
    </div>
  );
}
