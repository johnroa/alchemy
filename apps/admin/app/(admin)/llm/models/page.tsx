import { Database } from "lucide-react";
import { LlmConfigInfoBanner } from "@/components/admin/llm-config/info-banner";
import { LlmConfigPanel } from "@/components/admin/llm-config-panel";
import { PageHeader } from "@/components/admin/page-header";
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
      <LlmConfigInfoBanner
        icon={Database}
        title="DB-driven model catalog"
        body={
          <>
            All provider dropdowns across routing and simulations are populated from this registry. Currently{" "}
            <strong>{availableCount} of {config.models.length} models</strong> are marked available.
          </>
        }
      />

      <LlmConfigPanel mode="models" routes={config.routes} prompts={config.prompts} rules={config.rules} models={config.models} />
    </div>
  );
}
