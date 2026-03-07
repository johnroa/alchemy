"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

type AcquisitionSeriesPoint = {
  bucketStart: string;
  label: string;
  firstOpens: number;
  signIns: number;
  onboardingCompleted: number;
  firstRecipes: number;
  firstSaves: number;
  firstCooks: number;
};

const chartConfig = {
  firstOpens: { label: "First opens", color: "#38bdf8" },
  signIns: { label: "Sign-ins", color: "#34d399" },
  firstCooks: { label: "First cooks", color: "#f59e0b" },
} satisfies ChartConfig;

export function AcquisitionBoardTrendChart({
  data,
}: {
  data: AcquisitionSeriesPoint[];
}): React.JSX.Element {
  return (
    <ChartContainer config={chartConfig} className="h-[320px] w-full">
      <AreaChart data={data}>
        <defs>
          <linearGradient id="acquisition-first-opens" x1="0" x2="0" y1="0" y2="1">
            <stop offset="5%" stopColor="var(--color-firstOpens)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="var(--color-firstOpens)" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="acquisition-sign-ins" x1="0" x2="0" y1="0" y2="1">
            <stop offset="5%" stopColor="var(--color-signIns)" stopOpacity={0.26} />
            <stop offset="95%" stopColor="var(--color-signIns)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={16} />
        <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
        <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
        <Area type="monotone" dataKey="firstCooks" stroke="var(--color-firstCooks)" fillOpacity={0} strokeWidth={2} />
        <Area type="monotone" dataKey="signIns" stroke="var(--color-signIns)" fill="url(#acquisition-sign-ins)" strokeWidth={2} />
        <Area type="monotone" dataKey="firstOpens" stroke="var(--color-firstOpens)" fill="url(#acquisition-first-opens)" strokeWidth={2} />
      </AreaChart>
    </ChartContainer>
  );
}
