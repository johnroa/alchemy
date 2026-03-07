"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

type OperationsSeriesPoint = {
  bucketStart: string;
  label: string;
  calls: number;
  costUsd: number;
};

const chartConfig = {
  calls: { label: "Calls", color: "#38bdf8" },
  costUsd: { label: "Cost (USD)", color: "#f59e0b" },
} satisfies ChartConfig;

export function OperationsBoardTrendChart({
  data,
}: {
  data: OperationsSeriesPoint[];
}): React.JSX.Element {
  return (
    <ChartContainer config={chartConfig} className="h-[320px] w-full">
      <AreaChart data={data}>
        <defs>
          <linearGradient id="operations-calls" x1="0" x2="0" y1="0" y2="1">
            <stop offset="5%" stopColor="var(--color-calls)" stopOpacity={0.32} />
            <stop offset="95%" stopColor="var(--color-calls)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={16} />
        <YAxis yAxisId="calls" tickLine={false} axisLine={false} allowDecimals={false} />
        <YAxis yAxisId="cost" orientation="right" tickLine={false} axisLine={false} />
        <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
        <Area yAxisId="calls" type="monotone" dataKey="calls" stroke="var(--color-calls)" fill="url(#operations-calls)" strokeWidth={2} />
        <Area yAxisId="cost" type="monotone" dataKey="costUsd" stroke="var(--color-costUsd)" fillOpacity={0} strokeWidth={2} />
      </AreaChart>
    </ChartContainer>
  );
}
