import { describe, expect, it, vi } from "vitest";
import { formatCost, formatMs, formatPercent, formatTokens, timeAgo, toDecimal, toShortInteger } from "./format";

describe("format helpers", () => {
  it("formats cost across magnitude bands", () => {
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(0.00042)).toBe("$0.000420");
    expect(formatCost(0.0042)).toBe("$0.0042");
    expect(formatCost(1.234)).toBe("$1.23");
  });

  it("formats latency, percent, tokens, and numeric summaries", () => {
    expect(formatMs(950)).toBe("950ms");
    expect(formatMs(1_250)).toBe("1.3s");
    expect(formatPercent(0.126, 1)).toBe("12.6%");
    expect(formatTokens(1_250)).toBe("1.3K");
    expect(toDecimal(12.3456, 1)).toBe("12.3");
    expect(toShortInteger(12_345.6)).toBe("12,346");
  });

  it("formats relative times predictably", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-06T12:00:00.000Z"));

    expect(timeAgo("2026-03-06T11:59:40.000Z")).toBe("just now");
    expect(timeAgo("2026-03-06T11:10:00.000Z")).toBe("50m ago");
    expect(timeAgo("2026-03-06T09:00:00.000Z")).toBe("3h ago");
    expect(timeAgo("2026-03-02T12:00:00.000Z")).toBe("4d ago");

    vi.useRealTimers();
  });
});
