import { Info } from "lucide-react";
import { LlmConfigInfoBanner } from "@/components/admin/llm-config/info-banner";
import { LlmConfigPanel } from "@/components/admin/llm-config-panel";
import { PageHeader } from "@/components/admin/page-header";
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
      <LlmConfigInfoBanner
        icon={Info}
        title="Data-driven policy enforcement"
        body={
          <>
            Rules are evaluated in the gateway for each matching scope at request time.{" "}
            <strong>{activeCount} active rule{activeCount !== 1 ? "s" : ""}</strong> currently applied.
          </>
        }
      />

      <LlmConfigPanel mode="rules" routes={config.routes} prompts={config.prompts} rules={config.rules} models={config.models} />
    </div>
  );
}
