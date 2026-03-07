import { Info } from "lucide-react";
import { LlmConfigPanel } from "@/components/admin/llm-config-panel";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { getLlmConfigData } from "@/lib/admin-data";

export default async function RulesPage(): Promise<React.JSX.Element> {
  const config = await getLlmConfigData();

  const activeCount = config.rules.filter((r) => r.is_active).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rules"
        description="Policy and safety rules scoped by workflow. Rules are JSON-driven and hot-swappable."
      />
      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="flex items-start gap-3 py-4">
          <Info className="mt-0.5 h-4 w-4 flex-none text-blue-600" />
          <div className="space-y-0.5">
            <p className="text-sm font-medium text-blue-900">Data-driven policy enforcement</p>
            <p className="text-xs text-blue-700">
              Rules are evaluated in the gateway for each matching scope at request time.{" "}
              <strong>{activeCount} active rule{activeCount !== 1 ? "s" : ""}</strong> currently applied.
            </p>
          </div>
        </CardContent>
      </Card>

      <LlmConfigPanel mode="rules" routes={config.routes} prompts={config.prompts} rules={config.rules} models={config.models} />
    </div>
  );
}
