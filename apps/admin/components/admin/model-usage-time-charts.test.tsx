import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModelUsageTimeCharts, getUsageChartXAxisProps } from "./model-usage-time-charts";

vi.mock("recharts", () => {
  const wrapper = (testId: string) => {
    return function MockComponent(props: React.PropsWithChildren<Record<string, unknown>>): React.JSX.Element {
      return <div data-testid={testId}>{props.children}</div>;
    };
  };

  return {
    Area: wrapper("area"),
    AreaChart: wrapper("area-chart"),
    CartesianGrid: wrapper("cartesian-grid"),
    XAxis: (props: { interval?: string | number; minTickGap?: number; tickMargin?: number; height?: number }) => (
      <div
        data-testid="x-axis"
        data-interval={String(props.interval)}
        data-min-tick-gap={String(props.minTickGap)}
        data-tick-margin={String(props.tickMargin)}
        data-height={String(props.height)}
      />
    ),
    YAxis: wrapper("y-axis"),
  };
});

vi.mock("@/components/ui/chart", () => ({
  ChartContainer: ({ children }: React.PropsWithChildren) => <div data-testid="chart-container">{children}</div>,
  ChartTooltip: ({ children }: React.PropsWithChildren) => <div data-testid="chart-tooltip">{children}</div>,
  ChartTooltipContent: () => <div data-testid="chart-tooltip-content" />,
}));

describe("ModelUsageTimeCharts", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
  });

  it("renders explicit titles for both time-series charts", () => {
    render(
      <ModelUsageTimeCharts
        hourly={[{ bucketStart: "2026-03-07T00:00:00Z", label: "12:00 AM", calls: 12, tokens: 1200, costUsd: 0.2 }]}
        daily={[{ bucketStart: "2026-03-07T00:00:00Z", label: "Mar 7", calls: 12, tokens: 1200, costUsd: 0.2 }]}
      />,
    );

    expect(screen.getByText("Hourly Calls and Tokens")).toBeInTheDocument();
    expect(screen.getByText("Daily Cost and Calls")).toBeInTheDocument();
  });

  it("uses automatic tick preservation for dense x-axes", () => {
    expect(getUsageChartXAxisProps(30)).toEqual({
      interval: "preserveStartEnd",
      minTickGap: 28,
      tickMargin: 10,
      height: 40,
    });

    expect(getUsageChartXAxisProps(7)).toEqual({
      interval: 0,
      minTickGap: 16,
      tickMargin: 8,
      height: 32,
    });
  });
});
