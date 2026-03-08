import { Bot, Info } from "lucide-react";
import { LlmConfigInfoBanner } from "@/components/admin/llm-config/info-banner";
import { LlmConfigPanel } from "@/components/admin/llm-config-panel";
import { PageHeader } from "@/components/admin/page-header";
import { getLlmConfigData } from "@/lib/admin-data";

export default async function ProviderModelPage(): Promise<React.JSX.Element> {
  const config = await getLlmConfigData();

  const activeCount = config.routes.filter((r) => r.is_active).length;
  const routeScopeCount = new Set(config.routes.map((route) => route.scope)).size;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Model Routes"
        description="Configure active model routing for recipe generation, image generation, image quality evaluation, classification, onboarding, and memory scopes."
      />

      <LlmConfigInfoBanner
        icon={Info}
        trailingIcon={Bot}
        title="Server-controlled model routing"
        body={
          <>
            Runtime routing is read from database records and applied in the gateway at request time. Currently{" "}
            <strong>{activeCount} of {routeScopeCount} scopes</strong> have an active route configured.
          </>
        }
      />

      <LlmConfigPanel mode="routing" routes={config.routes} prompts={config.prompts} rules={config.rules} models={config.models} />
    </div>
  );
}
