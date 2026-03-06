import { Database } from "lucide-react";
import { LlmConfigPanel } from "@/components/admin/llm-config-panel";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { getLlmConfigData } from "@/lib/admin-data";

export default async function ModelsPage(): Promise<React.JSX.Element> {
  const config = await getLlmConfigData();

  const availableCount = config.models.filter((m) => m.is_available).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Model Registry"
        description="Manage available LLM models and their token or image billing metadata. Models listed here are available for routing and simulation overrides."
      />
      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="flex items-start gap-3 py-4">
          <Database className="mt-0.5 h-4 w-4 flex-none text-blue-600" />
          <div className="space-y-0.5">
            <p className="text-sm font-medium text-blue-900">DB-driven model catalog</p>
            <p className="text-xs text-blue-700">
              All provider dropdowns across routing and simulations are populated from this registry.
              Currently <strong>{availableCount} of {config.models.length} models</strong> are marked available.
            </p>
          </div>
        </CardContent>
      </Card>

      <LlmConfigPanel mode="models" routes={config.routes} prompts={config.prompts} rules={config.rules} models={config.models} />
    </div>
  );
}
