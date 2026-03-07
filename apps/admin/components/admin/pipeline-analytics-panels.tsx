"use client";

import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { ChartContainer, type ChartConfig, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

const throughputConfig = {
  images: { label: "Images", color: "#16a34a" },
  imports: { label: "Imports", color: "#2563eb" },
  metadata: { label: "Metadata", color: "#f59e0b" },
  memory: { label: "Memory", color: "#a855f7" },
} satisfies ChartConfig;

const statusConfig = {
  pending: { label: "Pending", color: "#f59e0b" },
  processing: { label: "Processing", color: "#2563eb" },
  ready: { label: "Ready", color: "#16a34a" },
  failed: { label: "Failed", color: "#dc2626" },
} satisfies ChartConfig;

export function PipelineAnalyticsPanels({
  throughput,
  statusBreakdown,
}: {
  throughput: Array<Record<string, number | string>>;
  statusBreakdown: Array<{ pipeline: string; pending: number; processing: number; ready: number; failed: number }>;
}): React.JSX.Element {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <ChartContainer config={throughputConfig} className="h-[320px] w-full">
        <LineChart data={throughput} margin={{ left: 8, right: 8, top: 12, bottom: 12 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={16} />
          <YAxis tickLine={false} axisLine={false} width={36} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Line dataKey="images" type="monotone" stroke="var(--color-images)" strokeWidth={2.2} dot={false} />
          <Line dataKey="imports" type="monotone" stroke="var(--color-imports)" strokeWidth={2.2} dot={false} />
          <Line dataKey="metadata" type="monotone" stroke="var(--color-metadata)" strokeWidth={2.2} dot={false} />
          <Line dataKey="memory" type="monotone" stroke="var(--color-memory)" strokeWidth={2.2} dot={false} />
        </LineChart>
      </ChartContainer>

      <ChartContainer config={statusConfig} className="h-[320px] w-full">
        <BarChart data={statusBreakdown} margin={{ left: 8, right: 8, top: 12, bottom: 12 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="pipeline" tickLine={false} axisLine={false} />
          <YAxis tickLine={false} axisLine={false} width={36} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey="pending" stackId="status" fill="var(--color-pending)" radius={[6, 6, 0, 0]} />
          <Bar dataKey="processing" stackId="status" fill="var(--color-processing)" />
          <Bar dataKey="ready" stackId="status" fill="var(--color-ready)" />
          <Bar dataKey="failed" stackId="status" fill="var(--color-failed)" />
        </BarChart>
      </ChartContainer>
    </div>
  );
}
