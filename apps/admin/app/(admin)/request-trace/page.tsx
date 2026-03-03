import { PageHeader } from "@/components/admin/page-header";
import { RequestTraceViewer } from "@/components/admin/request-trace-viewer";
import { getRequestTraceData } from "@/lib/admin-data";

export default async function RequestTracePage(): Promise<React.JSX.Element> {
  const data = await getRequestTraceData();

  const recentRequestIds = Array.from(
    new Set(
      [...data.events, ...data.changes]
        .map((item) => item.request_id)
        .filter((item): item is string => typeof item === "string" && item.length > 0)
    )
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Request Trace"
        description="Debug any request — click a row to see the full event payload, error details, scope, model, latency, and mutations."
      />

      <RequestTraceViewer recentRequestIds={recentRequestIds} events={data.events} />
    </div>
  );
}
