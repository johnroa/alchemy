import { describe, expect, it } from "vitest";
import type { AnalyticsQueryState } from "@/lib/admin-analytics";
import {
  buildAcquisitionBoardSnapshot,
  buildEngagementBoardSnapshot,
  buildOperationsBoardSnapshot,
} from "./boards";

const query: AnalyticsQueryState = {
  range: "30d",
  grain: "day",
  compare: "none",
};

describe("buildEngagementBoardSnapshot", () => {
  it("computes core engagement KPIs from behavior events", () => {
    const now = Date.now();
    const rows = [
      {
        event_type: "chat_turn_resolved",
        occurred_at: new Date(now - 5 * 60_000).toISOString(),
        install_id: "install-1",
        user_id: "user-1",
        entity_id: null,
        session_id: "session-1",
        source_surface: "chat",
        payload: { triggered_recipe: true, candidate_component_count: 2 },
      },
      {
        event_type: "chat_turn_submitted",
        occurred_at: new Date(now - 6 * 60_000).toISOString(),
        install_id: "install-1",
        user_id: "user-1",
        entity_id: null,
        session_id: "session-1",
        source_surface: "chat",
        payload: {},
      },
      {
        event_type: "chat_commit_completed",
        occurred_at: new Date(now - 4 * 60_000).toISOString(),
        install_id: "install-1",
        user_id: "user-1",
        entity_id: "recipe-1",
        session_id: "session-1",
        source_surface: "chat",
        payload: { committed_count: 1 },
      },
      {
        event_type: "recipe_saved",
        occurred_at: new Date(now - 3 * 60_000).toISOString(),
        install_id: "install-1",
        user_id: "user-1",
        entity_id: "recipe-1",
        session_id: "session-1",
        source_surface: "chat",
        payload: {},
      },
      {
        event_type: "recipe_cooked_inferred",
        occurred_at: new Date(now - 2 * 60_000).toISOString(),
        install_id: "install-1",
        user_id: "user-1",
        entity_id: "recipe-1",
        session_id: "detail-1",
        source_surface: "cookbook",
        payload: {},
      },
      {
        event_type: "cookbook_viewed",
        occurred_at: new Date(now - 90_000).toISOString(),
        install_id: "install-1",
        user_id: "user-1",
        entity_id: null,
        session_id: "cookbook-1",
        source_surface: "cookbook",
        payload: {},
      },
      {
        event_type: "cookbook_viewed",
        occurred_at: new Date(now - 60_000).toISOString(),
        install_id: "install-1",
        user_id: "user-1",
        entity_id: null,
        session_id: "cookbook-2",
        source_surface: "cookbook",
        payload: {},
      },
    ];

    const snapshot = buildEngagementBoardSnapshot(rows, query);

    expect(snapshot.totals.generatedRecipes).toBe(2);
    expect(snapshot.totals.acceptedRecipes).toBe(1);
    expect(snapshot.totals.savedRecipes).toBe(1);
    expect(snapshot.totals.cookedRecipes).toBe(1);
    expect(snapshot.summary.recipeAcceptanceRate).toBe(0.5);
    expect(snapshot.summary.recipeCompletionRate).toBe(1);
    expect(snapshot.summary.chatCandidateCommitRate).toBe(1);
    expect(snapshot.summary.cookbookRevisitRate).toBe(1);
    expect(snapshot.summary.generationToSaveTimeP50Seconds).toBe(60);
    expect(snapshot.topRecipes[0]).toMatchObject({
      recipeId: "recipe-1",
      saves: 1,
      cooks: 1,
    });
  });
});

describe("buildOperationsBoardSnapshot", () => {
  it("computes operations KPIs from llm and dashboard telemetry", () => {
    const behaviorRows = [
      {
        event_type: "chat_turn_resolved",
        occurred_at: new Date().toISOString(),
        install_id: "install-1",
        user_id: "user-1",
        entity_id: null,
        session_id: "session-1",
        source_surface: "chat",
        payload: { triggered_recipe: true, candidate_component_count: 1 },
      },
      {
        event_type: "chat_iteration_requested",
        occurred_at: new Date().toISOString(),
        install_id: "install-1",
        user_id: "user-1",
        entity_id: "recipe-1",
        session_id: "session-1",
        source_surface: "chat",
        payload: {},
      },
      {
        event_type: "chat_commit_completed",
        occurred_at: new Date().toISOString(),
        install_id: "install-1",
        user_id: "user-1",
        entity_id: "recipe-1",
        session_id: "session-1",
        source_surface: "chat",
        payload: { committed_count: 1 },
      },
    ];

    const llmRows = [
      {
        created_at: new Date().toISOString(),
        latency_ms: 1200,
        cost_usd: 0.04,
        event_payload: { scope: "chat_generation", error_code: "llm_empty_output" },
      },
      {
        created_at: new Date().toISOString(),
        latency_ms: 2400,
        cost_usd: 0.06,
        event_payload: { scope: "chat_generation" },
      },
    ];

    const snapshot = buildOperationsBoardSnapshot(
      behaviorRows,
      llmRows,
      {
        imagePendingCount: 2,
        imageFailedCount: 1,
        staleVariantCount: 3,
        requestCount: 20,
        safetyIncidentCount: 2,
        recentErrors: [],
      } as Awaited<ReturnType<typeof import("./overview").getDashboardData>>,
      {
        totalImports: 10,
        completedImports: 7,
        failedImports: 2,
      } as Awaited<ReturnType<typeof import("./imports").getImportData>>,
    );

    expect(snapshot.summary.generationLatencyP50Ms).toBe(1200);
    expect(snapshot.summary.generationLatencyP95Ms).toBe(2400);
    expect(snapshot.summary.immediateRegenerationRate).toBe(1);
    expect(snapshot.summary.structuredRecipeDefectRate).toBe(0.5);
    expect(snapshot.summary.costPerAcceptedRecipeUsd).toBeCloseTo(0.1, 6);
    expect(snapshot.summary.costPerRecipeUsd).toBeCloseTo(0.05, 6);
    expect(snapshot.summary.providerFailureRate).toBe(0.5);
    expect(snapshot.summary.pipelineFailureBacklog).toBe(8);
    expect(snapshot.summary.staleVariantBacklog).toBe(3);
    expect(snapshot.summary.safetyFlaggedResponseRate).toBe(0.1);
  });
});

describe("buildAcquisitionBoardSnapshot", () => {
  it("computes acquisition funnel and install-cohort retention metrics", () => {
    const now = Date.now();
    const installRows = [
      {
        install_id: "install-1",
        acquisition_channel: "organic",
        campaign_token: null,
        provider_token: null,
        first_opened_at: new Date(now - 20 * 24 * 60 * 60 * 1000).toISOString(),
        last_seen_at: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString(),
        snapshot: {},
      },
      {
        install_id: "install-2",
        acquisition_channel: "waitlist",
        campaign_token: null,
        provider_token: null,
        first_opened_at: new Date(now - 18 * 24 * 60 * 60 * 1000).toISOString(),
        last_seen_at: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
        snapshot: {},
      },
      {
        install_id: "install-3",
        acquisition_channel: "unknown",
        campaign_token: null,
        provider_token: null,
        first_opened_at: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString(),
        last_seen_at: new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString(),
        snapshot: {},
      },
    ];

    const acquisitionRows = [
      {
        user_id: "user-1",
        install_id: "install-1",
        acquisition_channel: "organic",
        lifecycle_stage: "habit",
        signed_in_at: new Date(now - 20 * 24 * 60 * 60 * 1000 + 60_000).toISOString(),
        onboarding_started_at: new Date(now - 20 * 24 * 60 * 60 * 1000 + 120_000).toISOString(),
        onboarding_completed_at: new Date(now - 20 * 24 * 60 * 60 * 1000 + 180_000).toISOString(),
        first_generation_at: new Date(now - 20 * 24 * 60 * 60 * 1000 + 300_000).toISOString(),
        first_save_at: new Date(now - 20 * 24 * 60 * 60 * 1000 + 480_000).toISOString(),
        first_cook_at: new Date(now - 19 * 24 * 60 * 60 * 1000).toISOString(),
        last_seen_at: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        user_id: "user-2",
        install_id: "install-2",
        acquisition_channel: "waitlist",
        lifecycle_stage: "saved",
        signed_in_at: new Date(now - 18 * 24 * 60 * 60 * 1000 + 120_000).toISOString(),
        onboarding_started_at: new Date(now - 18 * 24 * 60 * 60 * 1000 + 180_000).toISOString(),
        onboarding_completed_at: new Date(now - 18 * 24 * 60 * 60 * 1000 + 240_000).toISOString(),
        first_generation_at: new Date(now - 18 * 24 * 60 * 60 * 1000 + 360_000).toISOString(),
        first_save_at: null,
        first_cook_at: null,
        last_seen_at: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ];

    const cookRows = [
      {
        event_type: "recipe_cooked_inferred",
        occurred_at: new Date(now - 12 * 24 * 60 * 60 * 1000).toISOString(),
        install_id: "install-1",
        user_id: "user-1",
        entity_id: "recipe-1",
        session_id: "detail-1",
        source_surface: "cookbook",
        payload: {},
      },
      {
        event_type: "recipe_cooked_inferred",
        occurred_at: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(),
        install_id: "install-1",
        user_id: "user-1",
        entity_id: "recipe-2",
        session_id: "detail-2",
        source_surface: "cookbook",
        payload: {},
      },
    ];

    const snapshot = buildAcquisitionBoardSnapshot(installRows, acquisitionRows, cookRows, query);

    expect(snapshot.summary.firstOpens).toBe(3);
    expect(snapshot.summary.signInRate).toBeCloseTo(2 / 3, 6);
    expect(snapshot.summary.onboardingCompletionRate).toBeCloseTo(2 / 3, 6);
    expect(snapshot.summary.firstGenerationRate).toBeCloseTo(2 / 3, 6);
    expect(snapshot.summary.firstSaveRate).toBeCloseTo(1 / 3, 6);
    expect(snapshot.summary.firstCookWithin7dRate).toBeCloseTo(1 / 3, 6);
    expect(snapshot.summary.medianTimeToSignInSeconds).toBe(60);
    expect(snapshot.summary.returningCooks7dRate).toBeCloseTo(0.5, 6);
    expect(snapshot.sourceMix[0]).toMatchObject({
      channel: "organic",
      installs: 1,
      signIns: 1,
      firstCooksWithin7d: 1,
    });
    expect(snapshot.cohortRetention.some((row) => row.returningCookInstalls > 0)).toBe(true);
  });
});
