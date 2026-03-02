import { LlmConfigPanel } from "@/components/admin/llm-config-panel";
import { LlmSubnav } from "@/components/admin/llm-subnav";
import { PageHeader } from "@/components/admin/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getLlmConfigData } from "@/lib/admin-data";

export default async function ProviderModelPage(): Promise<React.JSX.Element> {
  const config = await getLlmConfigData();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Provider & Model"
        description="Configure model routing for generate, tweak, classify, and image workflows."
      />
      <LlmSubnav />
      <Alert>
        <AlertTitle>Server-controlled model behavior</AlertTitle>
        <AlertDescription>
          Runtime routing is read from database records and applied in the gateway at request time.
        </AlertDescription>
      </Alert>
      <LlmConfigPanel mode="routing" routes={config.routes} prompts={config.prompts} rules={config.rules} />
    </div>
  );
}
