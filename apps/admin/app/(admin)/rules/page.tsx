import { LlmConfigPanel } from "@/components/admin/llm-config-panel";
import { LlmSubnav } from "@/components/admin/llm-subnav";
import { PageHeader } from "@/components/admin/page-header";
import { getLlmConfigData } from "@/lib/admin-data";

export default async function RulesPage(): Promise<React.JSX.Element> {
  const config = await getLlmConfigData();

  return (
    <div className="space-y-6">
      <PageHeader title="Rules" description="Policy and safety rules scoped by workflow." />
      <LlmSubnav />
      <LlmConfigPanel mode="rules" routes={config.routes} prompts={config.prompts} rules={config.rules} />
    </div>
  );
}
