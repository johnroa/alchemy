import { Info } from "lucide-react";
import { LlmConfigPanel } from "@/components/admin/llm-config-panel";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { getLlmConfigData } from "@/lib/admin-data";

export default async function PromptsPage(): Promise<React.JSX.Element> {
  const config = await getLlmConfigData();

  const activeCount = config.prompts.filter((p) => p.is_active).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Prompts"
        description="Version and manage all LLM instruction templates. Each scope has one active prompt at a time."
      />
      <Card className="border-blue-200 bg-blue-50/40">
        <CardContent className="flex items-start gap-3 py-4">
          <Info className="mt-0.5 h-4 w-4 flex-none text-blue-600" />
          <div className="space-y-0.5">
            <p className="text-sm font-medium text-blue-900">Single source of LLM behavior</p>
            <p className="text-xs text-blue-700">
              The runtime gateway reads the active prompt template for each scope at request time. Currently{" "}
              <strong>{activeCount} active prompt{activeCount !== 1 ? "s" : ""}</strong> across all scopes.
            </p>
          </div>
        </CardContent>
      </Card>

      <LlmConfigPanel mode="prompts" routes={config.routes} prompts={config.prompts} rules={config.rules} models={config.models} />
    </div>
  );
}
