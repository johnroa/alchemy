import { Flag } from "lucide-react";
import { FeatureFlagsPanel } from "@/components/admin/feature-flags-panel";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { getFeatureFlagsData } from "@/lib/admin-data";

export default async function FlagsPage(): Promise<React.JSX.Element> {
  const data = await getFeatureFlagsData();
  const activeCount = data.flags.filter((flag) => !flag.archived_at).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Flags"
        description="DB-backed runtime flags for rollout control and remote config. Values resolve server-side by environment at request time."
        icon={<Flag className="h-6 w-6" />}
        actions={
          <Badge variant="outline" className="font-mono text-xs">
            {activeCount} active
          </Badge>
        }
      />

      <FeatureFlagsPanel initialData={data} />
    </div>
  );
}
