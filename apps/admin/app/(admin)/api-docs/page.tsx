import { PageHeader } from "@/components/admin/page-header";
import { ApiVisualizer } from "@/components/admin/api-visualizer";
import spec from "@/lib/openapi-spec.json";
import { ADMIN_ROUTES } from "@/lib/admin-routes";

/**
 * API Reference page — renders the OpenAPI spec and admin route inventory.
 * Both are static imports bundled at build time so the page works on
 * Cloudflare Workers (no filesystem at runtime).
 */
export default function ApiDocsPage(): React.JSX.Element {
  return (
    <div className="space-y-6">
      <PageHeader
        title="API Reference"
        description="Auto-generated from the OpenAPI specification and admin route handlers"
      />
      <ApiVisualizer
        spec={spec as unknown as Record<string, unknown>}
        adminRoutes={ADMIN_ROUTES}
      />
    </div>
  );
}
