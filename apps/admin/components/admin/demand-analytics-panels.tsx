"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, type ChartConfig, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

const config = {
  observations: { label: "Observations", color: "#0f766e" },
  outcomes: { label: "Outcomes", color: "#1d4ed8" },
  commits: { label: "Commits", color: "#ea580c" },
  cooks: { label: "Cooks", color: "#dc2626" },
} satisfies ChartConfig;

export function DemandAnalyticsPanels({
  data,
}: {
  data: Array<Record<string, number | string>>;
}): React.JSX.Element {
  return (
    <ChartContainer config={config} className="h-[320px] w-full">
      <AreaChart data={data} margin={{ left: 8, right: 8, top: 12, bottom: 12 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={16} />
        <YAxis tickLine={false} axisLine={false} width={36} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Area dataKey="observations" type="monotone" stroke="var(--color-observations)" fill="var(--color-observations)" fillOpacity={0.16} strokeWidth={2} />
        <Area dataKey="outcomes" type="monotone" stroke="var(--color-outcomes)" fill="var(--color-outcomes)" fillOpacity={0.12} strokeWidth={2} />
        <Area dataKey="commits" type="monotone" stroke="var(--color-commits)" fill="var(--color-commits)" fillOpacity={0.1} strokeWidth={2} />
        <Area dataKey="cooks" type="monotone" stroke="var(--color-cooks)" fill="var(--color-cooks)" fillOpacity={0.08} strokeWidth={2} />
      </AreaChart>
    </ChartContainer>
  );
}
