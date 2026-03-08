"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  type ChartConfig,
  ChartTooltip,
  ChartTooltipContent
} from "@/components/ui/chart";
import { formatCost, formatTokens } from "@/lib/format";

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

const formatTicks = (value: number): string => {
  return formatTokens(value);
};

const getUsageChartXAxisProps = (
  pointCount: number,
): {
  interval: 0 | "preserveStartEnd";
  minTickGap: number;
  tickMargin: number;
  height: number;
} => {
  if (pointCount > 12) {
    return {
      interval: "preserveStartEnd",
      minTickGap: 28,
      tickMargin: 10,
      height: 40,
    };
  }

  return {
    interval: 0,
    minTickGap: 16,
    tickMargin: 8,
    height: 32,
  };
};

export function ModelUsageTimeCharts({
  hourly,
  daily
}: {
  hourly: UsagePoint[];
  daily: UsagePoint[];
}): React.JSX.Element {
  const hourlyXAxisProps = getUsageChartXAxisProps(hourly.length);
  const dailyXAxisProps = getUsageChartXAxisProps(daily.length);

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section className="space-y-3">
        <div className="space-y-1">
          <h3 className="text-sm font-medium tracking-tight text-foreground">Hourly Calls and Tokens</h3>
          <p className="text-xs text-muted-foreground">Last 24 hours of token volume and LLM call throughput.</p>
        </div>
        <ChartContainer config={hourlyConfig} className="h-[260px] w-full">
          <AreaChart data={hourly} margin={{ left: 8, right: 8, top: 12, bottom: 12 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              {...hourlyXAxisProps}
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
      </section>

      <section className="space-y-3">
        <div className="space-y-1">
          <h3 className="text-sm font-medium tracking-tight text-foreground">Daily Cost and Calls</h3>
          <p className="text-xs text-muted-foreground">Selected-range spend alongside daily request volume.</p>
        </div>
        <ChartContainer config={dailyConfig} className="h-[260px] w-full">
          <AreaChart data={daily} margin={{ left: 8, right: 8, top: 12, bottom: 12 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              {...dailyXAxisProps}
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
      </section>
    </div>
  );
}

export { getUsageChartXAxisProps };
