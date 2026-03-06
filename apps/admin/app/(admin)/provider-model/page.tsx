import { Bot, Info } from "lucide-react";
import { LlmConfigPanel } from "@/components/admin/llm-config-panel";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { getLlmConfigData } from "@/lib/admin-data";

export default async function ProviderModelPage(): Promise<React.JSX.Element> {
  const config = await getLlmConfigData();

  const activeCount = config.routes.filter((r) => r.is_active).length;
  const routeScopeCount = new Set(config.routes.map((route) => route.scope)).size;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Model Assignments"
        description="Configure model routing for recipe generation, image generation, image quality eval, classification, onboarding, and memory scopes."
      />

      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="flex items-start gap-3 py-4">
          <Info className="mt-0.5 h-4 w-4 flex-none text-blue-600" />
          <div className="space-y-0.5">
            <p className="text-sm font-medium text-blue-900">Server-controlled model routing</p>
            <p className="text-xs text-blue-700">
              Runtime routing is read from database records and applied in the gateway at request time.
              Currently <strong>{activeCount} of {routeScopeCount} scopes</strong> have an active route configured.
            </p>
          </div>
          <Bot className="ml-auto mt-0.5 h-4 w-4 flex-none text-blue-400" />
        </CardContent>
      </Card>

      <LlmConfigPanel mode="routing" routes={config.routes} prompts={config.prompts} rules={config.rules} models={config.models} />
    </div>
  );
}
