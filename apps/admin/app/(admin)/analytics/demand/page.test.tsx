import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AnalyticsDemandPage from "./page";

const { getDemandAnalyticsData } = vi.hoisted(() => ({
  getDemandAnalyticsData: vi.fn(),
}));

vi.mock("@/lib/admin-data", () => ({
  getDemandAnalyticsData,
}));

vi.mock("@/components/admin/filter-bar", () => ({
  FilterBar: () => <div data-testid="filter-bar" />,
}));

vi.mock("@/components/admin/demand-analytics-panels", () => ({
  DemandAnalyticsPanels: () => <div data-testid="demand-analytics-panels" />,
}));

vi.mock("@/components/admin/demand-review-queue", () => ({
  DemandReviewQueue: () => <div data-testid="demand-review-queue" />,
}));

describe("AnalyticsDemandPage", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
    getDemandAnalyticsData.mockResolvedValue({
      summary: {
        observations: 144,
        intents: 98,
        feedbackObservations: 21,
        outcomes: 64,
        sampledForReview: 12,
        pendingReview: 3,
        queuePending: 4,
        queueFailures: 1,
        graphEdges: 42,
        freshnessMinutes: 8,
      },
      series: [],
      topIntentRows: [{ facet: "goal", value: "high_protein", observations: 12, avgConfidence: 0.88 }],
      risingIntentRows: [{ facet: "ingredient_want", value: "chili_crunch", recentObservations: 5, priorObservations: 1, delta: 4 }],
      unmetNeedRows: [{ facet: "dish", value: "noodle_bowl", observations: 4, successRate: 0.25 }],
      outcomeRows: [{ outcomeType: "recipe_committed", count: 14, rate: 0.1 }],
      substitutionRows: [{ original: "butter", replacement: "olive oil", accepted: 4, reverted: 1, acceptanceRate: 0.8 }],
      graphRows: [{
        fromFacet: "goal",
        fromValue: "high_protein",
        toFacet: "outcome",
        toValue: "recipe_committed",
        count: 11,
        recencyWeightedScore: 7.2,
        acceptanceScore: 0.48,
        stage: "intent",
        sourceKind: "chat_message",
        lastObservedAt: new Date().toISOString(),
        timeWindow: "30d",
      }],
      scopeQualityRows: [{
        scope: "demand_extract_observation",
        version: 1,
        observations: 88,
        sampled: 9,
        pending: 3,
        confirmed: 5,
        rejected: 1,
        precision: 0.83,
        factCoverage: 0.92,
      }],
      recentTraces: [],
      reviewQueue: {
        sampled: 12,
        pending: 3,
        rows: [],
      },
    });
  });

  it("renders demand graph analytics surfaces and review copy", async () => {
    const { container } = render(await AnalyticsDemandPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("Demand Graph")).toBeInTheDocument();
    expect(screen.getByText("Demand Observations")).toBeInTheDocument();
    expect(screen.getByText("Review Backlog")).toBeInTheDocument();
    expect(screen.getByText("Demand Activity Trend")).toBeInTheDocument();
    expect(screen.getByText("Demand Explorer")).toBeInTheDocument();
    expect(screen.getByText("Visual Explorer")).toBeInTheDocument();
    expect(screen.getByText("Extraction Quality")).toBeInTheDocument();
    expect(screen.getByText("Recent Traces")).toBeInTheDocument();
    expect(container.querySelector(".bg-white")).toBeNull();
  });
});
