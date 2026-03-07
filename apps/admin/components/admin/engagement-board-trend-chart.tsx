"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

type EngagementSeriesPoint = {
  bucketStart: string;
  label: string;
  cooks: number;
  saves: number;
  generations: number;
  cookbookViews: number;
};

const chartConfig = {
  cooks: { label: "Cooks", color: "#10b981" },
  saves: { label: "Saves", color: "#38bdf8" },
  generations: { label: "Generated", color: "#f59e0b" },
} satisfies ChartConfig;

export function EngagementBoardTrendChart({
  data,
}: {
  data: EngagementSeriesPoint[];
}): React.JSX.Element {
  return (
    <ChartContainer config={chartConfig} className="h-[320px] w-full">
      <AreaChart data={data}>
        <defs>
          <linearGradient id="engagement-cooks" x1="0" x2="0" y1="0" y2="1">
            <stop offset="5%" stopColor="var(--color-cooks)" stopOpacity={0.4} />
            <stop offset="95%" stopColor="var(--color-cooks)" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="engagement-saves" x1="0" x2="0" y1="0" y2="1">
            <stop offset="5%" stopColor="var(--color-saves)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--color-saves)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={16} />
        <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
        <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
        <Area type="monotone" dataKey="generations" stroke="var(--color-generations)" fillOpacity={0} strokeWidth={2} />
        <Area type="monotone" dataKey="saves" stroke="var(--color-saves)" fill="url(#engagement-saves)" strokeWidth={2} />
        <Area type="monotone" dataKey="cooks" stroke="var(--color-cooks)" fill="url(#engagement-cooks)" strokeWidth={2} />
      </AreaChart>
    </ChartContainer>
  );
}
