import { describe, expect, it } from "vitest";
import {
  compareModelUsageActionRows,
  DEFAULT_MODEL_USAGE_ACTION_SORT,
  getModelUsageActionSortValue,
  parseModelUsageActionSort,
} from "./llm-analytics";

const rows = [
  { label: "Chat", calls: 4, totalTokens: 900, costUsd: 0.72 },
  { label: "Generate", calls: 8, totalTokens: 1_500, costUsd: 0.4 },
  { label: "Images", calls: 2, totalTokens: 300, costUsd: 0.6 },
];

describe("llm analytics helpers", () => {
  it("falls back to the default sort for invalid values", () => {
    expect(parseModelUsageActionSort("not-real")).toBe(DEFAULT_MODEL_USAGE_ACTION_SORT);
  });

  it("parses valid action sort values", () => {
    expect(parseModelUsageActionSort("total_cost")).toBe("total_cost");
    expect(parseModelUsageActionSort("cost_per_call")).toBe("cost_per_call");
  });

  it("returns the expected metric values for each sort mode", () => {
    expect(getModelUsageActionSortValue(rows[0], "total_calls")).toBe(4);
    expect(getModelUsageActionSortValue(rows[0], "total_tokens")).toBe(900);
    expect(getModelUsageActionSortValue(rows[0], "total_cost")).toBe(0.72);
    expect(getModelUsageActionSortValue(rows[0], "cost_per_call")).toBe(0.18);
  });

  it("sorts action rows by the selected metric in descending order", () => {
    expect([...rows].sort((left, right) => compareModelUsageActionRows(left, right, "total_calls")).map((row) => row.label)).toEqual([
      "Generate",
      "Chat",
      "Images",
    ]);

    expect(
      [...rows].sort((left, right) => compareModelUsageActionRows(left, right, "total_tokens")).map((row) => row.label),
    ).toEqual(["Generate", "Chat", "Images"]);

    expect([...rows].sort((left, right) => compareModelUsageActionRows(left, right, "total_cost")).map((row) => row.label)).toEqual([
      "Chat",
      "Images",
      "Generate",
    ]);

    expect(
      [...rows].sort((left, right) => compareModelUsageActionRows(left, right, "cost_per_call")).map((row) => row.label),
    ).toEqual(["Images", "Chat", "Generate"]);
  });
});
