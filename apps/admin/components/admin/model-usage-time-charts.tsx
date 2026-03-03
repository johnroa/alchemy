"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  type ChartConfig,
  ChartTooltip,
  ChartTooltipContent
} from "@/components/ui/chart";

type UsagePoint = {
  bucketStart: string;
  label: string;
  calls: number;
  tokens: number;
  costUsd: number;
};

const hourlyConfig = {
  tokens: {
    label: "Tokens",
    color: "hsl(var(--chart-1))"
  },
  calls: {
    label: "Calls",
    color: "hsl(var(--chart-2))"
  }
} satisfies ChartConfig;

const dailyConfig = {
  costUsd: {
    label: "Cost (USD)",
    color: "hsl(var(--chart-3))"
  },
  calls: {
    label: "Calls",
    color: "hsl(var(--chart-2))"
  }
} satisfies ChartConfig;

const formatCost = (value: number): string => {
  if (value < 0.001) return `$${value.toFixed(4)}`;
  if (value < 0.01) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
};

const formatTicks = (value: number): string => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return `${Math.round(value)}`;
};

export function ModelUsageTimeCharts({
  hourly,
  daily
}: {
  hourly: UsagePoint[];
  daily: UsagePoint[];
}): React.JSX.Element {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <ChartContainer config={hourlyConfig} className="h-[260px] w-full">
        <AreaChart data={hourly} margin={{ left: 8, right: 8, top: 12, bottom: 12 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            interval={2}
            minTickGap={12}
          />
          <YAxis yAxisId="left" tickLine={false} axisLine={false} tickFormatter={formatTicks} width={48} />
          <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} width={36} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value, name) => {
                  if (name === "tokens") {
                    return (
                      <>
                        <span>Tokens</span>
                        <span className="font-mono tabular-nums">{formatTicks(Number(value))}</span>
                      </>
                    );
                  }

                  return (
                    <>
                      <span>Calls</span>
                      <span className="font-mono tabular-nums">{Number(value).toLocaleString()}</span>
                    </>
                  );
                }}
              />
            }
          />
          <Area
            yAxisId="left"
            dataKey="tokens"
            type="monotone"
            fill="var(--color-tokens)"
            fillOpacity={0.2}
            stroke="var(--color-tokens)"
            strokeWidth={2}
          />
          <Area
            yAxisId="right"
            dataKey="calls"
            type="monotone"
            fill="var(--color-calls)"
            fillOpacity={0.18}
            stroke="var(--color-calls)"
            strokeWidth={1.75}
          />
        </AreaChart>
      </ChartContainer>

      <ChartContainer config={dailyConfig} className="h-[260px] w-full">
        <AreaChart data={daily} margin={{ left: 8, right: 8, top: 12, bottom: 12 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            interval={0}
            minTickGap={12}
          />
          <YAxis
            yAxisId="left"
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => formatCost(Number(value))}
            width={56}
          />
          <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} width={36} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value, name) => {
                  if (name === "costUsd") {
                    return (
                      <>
                        <span>Cost</span>
                        <span className="font-mono tabular-nums">{formatCost(Number(value))}</span>
                      </>
                    );
                  }

                  return (
                    <>
                      <span>Calls</span>
                      <span className="font-mono tabular-nums">{Number(value).toLocaleString()}</span>
                    </>
                  );
                }}
              />
            }
          />
          <Area
            yAxisId="left"
            dataKey="costUsd"
            type="monotone"
            fill="var(--color-costUsd)"
            fillOpacity={0.22}
            stroke="var(--color-costUsd)"
            strokeWidth={2}
          />
          <Area
            yAxisId="right"
            dataKey="calls"
            type="monotone"
            fill="var(--color-calls)"
            fillOpacity={0.15}
            stroke="var(--color-calls)"
            strokeWidth={1.5}
          />
        </AreaChart>
      </ChartContainer>
    </div>
  );
}
