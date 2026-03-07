"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, type ChartConfig, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

const config = {
  users: { label: "Users", color: "#0f766e" },
  cookbook: { label: "Cookbook", color: "#1d4ed8" },
  variants: { label: "Variants", color: "#ea580c" },
} satisfies ChartConfig;

export function ProductAnalyticsPanels({
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
        <Area dataKey="users" type="monotone" stroke="var(--color-users)" fill="var(--color-users)" fillOpacity={0.16} strokeWidth={2} />
        <Area dataKey="cookbook" type="monotone" stroke="var(--color-cookbook)" fill="var(--color-cookbook)" fillOpacity={0.14} strokeWidth={2} />
        <Area dataKey="variants" type="monotone" stroke="var(--color-variants)" fill="var(--color-variants)" fillOpacity={0.12} strokeWidth={2} />
      </AreaChart>
    </ChartContainer>
  );
}
