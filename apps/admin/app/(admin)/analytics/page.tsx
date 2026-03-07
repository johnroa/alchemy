import { Activity, AlertTriangle, Coins, ImageOff, PackageSearch, Sparkles } from "lucide-react";
import { KpiCard } from "@/components/admin/kpi-card";
import { SectionLanding } from "@/components/admin/section-landing";
import { getAnalyticsOverviewData } from "@/lib/admin-data";
import { formatCost, formatPercent } from "@/lib/format";

export default async function AnalyticsLandingPage(): Promise<React.JSX.Element> {
  const data = await getAnalyticsOverviewData();

  return (
    <SectionLanding sectionKey="analytics" eyebrow="Chart-first telemetry">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <KpiCard label="LLM Calls" value={data.summary.llmCalls.toLocaleString()} hint="Current analytics window" icon={Activity} />
        <KpiCard label="Model Cost" value={formatCost(data.summary.totalCost)} hint="Estimated from registry pricing" icon={Coins} />
        <KpiCard label="Imports" value={data.summary.imports.toLocaleString()} hint={`${formatPercent(data.summary.importSuccessRate, 1)} success rate`} icon={PackageSearch} />
        <KpiCard label="Image Failures" value={String(data.summary.imageFailures)} hint="Requests needing retry or policy review" icon={ImageOff} variant={data.summary.imageFailures > 0 ? "danger" : "success"} />
        <KpiCard label="Stale Variants" value={String(data.summary.staleVariants)} hint="User variants waiting for refresh or review" icon={Sparkles} variant={data.summary.staleVariants > 0 ? "warning" : "success"} />
        <KpiCard label="Attention" value={data.summary.imageFailures + data.summary.staleVariants > 0 ? "Action needed" : "Stable"} hint="Operational hotspots surfaced from cross-domain metrics" icon={AlertTriangle} variant={data.summary.imageFailures + data.summary.staleVariants > 0 ? "warning" : "success"} />
      </div>
    </SectionLanding>
  );
}
