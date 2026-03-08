import { Info } from "lucide-react";
import { LlmConfigInfoBanner } from "@/components/admin/llm-config/info-banner";
import { LlmConfigPanel } from "@/components/admin/llm-config-panel";
import { PageHeader } from "@/components/admin/page-header";
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
      <LlmConfigInfoBanner
        icon={Info}
        title="Single source of LLM behavior"
        body={
          <>
            The runtime gateway reads the active prompt template for each scope at request time. Currently{" "}
            <strong>{activeCount} active prompt{activeCount !== 1 ? "s" : ""}</strong> across all scopes.
          </>
        }
      />

      <LlmConfigPanel mode="prompts" routes={config.routes} prompts={config.prompts} rules={config.rules} models={config.models} />
    </div>
  );
}
