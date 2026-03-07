import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AnalyticsProductPage from "./page";

const { getProductAnalyticsData } = vi.hoisted(() => ({
  getProductAnalyticsData: vi.fn(),
}));

vi.mock("@/lib/admin-data", () => ({
  getProductAnalyticsData,
}));

vi.mock("@/components/admin/filter-bar", () => ({
  FilterBar: () => <div data-testid="filter-bar" />,
}));

vi.mock("@/components/admin/product-analytics-panels", () => ({
  ProductAnalyticsPanels: () => <div data-testid="product-analytics-panels" />,
}));

describe("AnalyticsProductPage", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
    getProductAnalyticsData.mockResolvedValue({
      summary: {
        users: 58,
        newUsers: 58,
        cookbookEntries: 15,
        newCookbookEntries: 15,
        variants: 9,
        newVariants: 4,
        staleVariants: 2,
        recipes: 124,
        recipeUpdates: 12,
        ingredients: 387,
        ingredientUpdates: 19,
      },
      series: [],
    });
  });

  it("renders adoption and catalog metrics with explicit cookbook save copy", async () => {
    render(await AnalyticsProductPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("Product Analytics")).toBeInTheDocument();
    expect(screen.getByText("Cookbook Saves")).toBeInTheDocument();
    expect(screen.getByText("15 new saves in selected range.")).toBeInTheDocument();
    expect(screen.getByText("Catalog Footprint")).toBeInTheDocument();
    expect(screen.getByText("12 recipe updates · 19 ingredient updates")).toBeInTheDocument();
    expect(screen.getByText("Adoption trend")).toBeInTheDocument();
  });
});
