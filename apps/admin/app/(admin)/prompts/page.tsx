import { LlmConfigPanel } from "@/components/admin/llm-config-panel";
import { PageHeader } from "@/components/admin/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getLlmConfigData } from "@/lib/admin-data";

export default async function PromptsPage(): Promise<React.JSX.Element> {
  const config = await getLlmConfigData();

  return (
    <div className="space-y-6">
      <PageHeader title="Prompts & Provider Routing" description="Provider/model selection and all prompt instructions are managed here." />
      <Alert>
        <AlertTitle>Single source of LLM behavior</AlertTitle>
        <AlertDescription>
          Runtime gateway reads active provider/model route, active prompt template, and active rules from database records.
        </AlertDescription>
      </Alert>
      <LlmConfigPanel routes={config.routes} prompts={config.prompts} rules={config.rules} />
    </div>
  );
}
