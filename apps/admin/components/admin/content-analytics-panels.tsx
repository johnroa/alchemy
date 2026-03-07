"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, type ChartConfig, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

const config = {
  recipes: { label: "Recipes", color: "#16a34a" },
  ingredients: { label: "Ingredients", color: "#0f766e" },
} satisfies ChartConfig;

export function ContentAnalyticsPanels({
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
        <Area dataKey="recipes" type="monotone" stroke="var(--color-recipes)" fill="var(--color-recipes)" fillOpacity={0.18} strokeWidth={2} />
        <Area dataKey="ingredients" type="monotone" stroke="var(--color-ingredients)" fill="var(--color-ingredients)" fillOpacity={0.12} strokeWidth={2} />
      </AreaChart>
    </ChartContainer>
  );
}
