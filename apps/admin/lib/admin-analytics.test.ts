import { describe, expect, it } from "vitest";
import { DEFAULT_ANALYTICS_QUERY, PIPELINE_ANALYTICS_QUERY, getDaysForRange, parseAnalyticsQueryState } from "./admin-analytics";

describe("parseAnalyticsQueryState", () => {
  it("falls back to defaults for invalid values", () => {
    expect(
      parseAnalyticsQueryState(
        {
          range: "wat",
          grain: "month",
          compare: "later",
        },
        DEFAULT_ANALYTICS_QUERY,
      ),
    ).toEqual(DEFAULT_ANALYTICS_QUERY);
  });

  it("preserves valid values and optional segment", () => {
    expect(
      parseAnalyticsQueryState(
        {
          range: "7d",
          grain: "week",
          compare: "none",
          segment: "images",
        },
        PIPELINE_ANALYTICS_QUERY,
      ),
    ).toEqual({
      range: "7d",
      grain: "week",
      compare: "none",
      segment: "images",
    });
  });

  it("maps ranges to day counts used by analytics builders", () => {
    expect(getDaysForRange("24h")).toBe(1);
    expect(getDaysForRange("30d")).toBe(30);
    expect(getDaysForRange("90d")).toBe(90);
  });
});
