"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

type PersonalizationSeriesPoint = {
  bucketStart: string;
  label: string;
  impressions: number;
  opens: number;
  saves: number;
  cooks: number;
  fallbackFeeds: number;
};

const chartConfig = {
  impressions: { label: "Impressions", color: "#38bdf8" },
  saves: { label: "Saves", color: "#10b981" },
  cooks: { label: "Cooks", color: "#f59e0b" },
  fallbackFeeds: { label: "Fallback feeds", color: "#f43f5e" },
} satisfies ChartConfig;

export function PersonalizationBoardTrendChart({
  data,
}: {
  data: PersonalizationSeriesPoint[];
}): React.JSX.Element {
  return (
    <ChartContainer config={chartConfig} className="h-[320px] w-full">
      <AreaChart data={data}>
        <defs>
          <linearGradient id="personalization-impressions" x1="0" x2="0" y1="0" y2="1">
            <stop offset="5%" stopColor="var(--color-impressions)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="var(--color-impressions)" stopOpacity={0.03} />
          </linearGradient>
          <linearGradient id="personalization-saves" x1="0" x2="0" y1="0" y2="1">
            <stop offset="5%" stopColor="var(--color-saves)" stopOpacity={0.22} />
            <stop offset="95%" stopColor="var(--color-saves)" stopOpacity={0.01} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={16} />
        <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
        <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
        <Area
          type="monotone"
          dataKey="impressions"
          stroke="var(--color-impressions)"
          fill="url(#personalization-impressions)"
          strokeWidth={2}
        />
        <Area
          type="monotone"
          dataKey="saves"
          stroke="var(--color-saves)"
          fill="url(#personalization-saves)"
          strokeWidth={2}
        />
        <Area
          type="monotone"
          dataKey="cooks"
          stroke="var(--color-cooks)"
          fillOpacity={0}
          strokeWidth={2}
        />
        <Area
          type="monotone"
          dataKey="fallbackFeeds"
          stroke="var(--color-fallbackFeeds)"
          fillOpacity={0}
          strokeWidth={2}
        />
      </AreaChart>
    </ChartContainer>
  );
}
