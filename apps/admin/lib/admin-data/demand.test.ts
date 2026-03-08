import { describe, expect, it } from "vitest";
import type { AnalyticsQueryState } from "@/lib/admin-analytics";
import { buildDemandAnalyticsSnapshot } from "./demand";

const query: AnalyticsQueryState = {
  range: "30d",
  grain: "day",
  compare: "none",
};

describe("buildDemandAnalyticsSnapshot", () => {
  it("summarizes intent, unmet demand, substitutions, and review backlog", () => {
    const now = Date.now();
    const snapshot = buildDemandAnalyticsSnapshot({
      query,
      observations: [
        {
          id: "obs-1",
          source_kind: "chat_message",
          source_id: "msg-1",
          stage: "intent",
          extractor_scope: "demand_extract_observation",
          extractor_version: 1,
          confidence: 0.92,
          observed_at: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
          review_status: "pending",
          sampled_for_review: true,
          admin_snippet_redacted: "high-protein spicy noodle bowl",
          raw_trace_ref: "chat_messages/msg-1",
          summary_jsonb: { summary: "High-protein spicy noodles" },
          user_id: "user-1",
          chat_session_id: "chat-1",
          recipe_id: null,
          variant_id: null,
        },
        {
          id: "obs-2",
          source_kind: "chat_message",
          source_id: "msg-2",
          stage: "intent",
          extractor_scope: "demand_extract_observation",
          extractor_version: 1,
          confidence: 0.86,
          observed_at: new Date(now - 6 * 60 * 60 * 1000).toISOString(),
          review_status: "confirmed",
          sampled_for_review: true,
          admin_snippet_redacted: "crispy chili crunch noodles",
          raw_trace_ref: "chat_messages/msg-2",
          summary_jsonb: { summary: "Crispy chili crunch noodles" },
          user_id: "user-2",
          chat_session_id: "chat-2",
          recipe_id: null,
          variant_id: null,
        },
        {
          id: "obs-3",
          source_kind: "chat_message",
          source_id: "msg-3",
          stage: "intent",
          extractor_scope: "demand_extract_observation",
          extractor_version: 1,
          confidence: 0.81,
          observed_at: new Date(now - 3 * 60 * 60 * 1000).toISOString(),
          review_status: "pending",
          sampled_for_review: false,
          admin_snippet_redacted: "another chili crunch noodle request",
          raw_trace_ref: "chat_messages/msg-3",
          summary_jsonb: { summary: "Another chili crunch ask" },
          user_id: "user-3",
          chat_session_id: "chat-3",
          recipe_id: null,
          variant_id: null,
        },
      ],
      facts: [
        {
          observation_id: "obs-1",
          facet: "goal",
          normalized_value: "high_protein",
          raw_value: "high protein",
          confidence: 0.92,
          rank: 1,
          entity_id: null,
          metadata_jsonb: {},
        },
        {
          observation_id: "obs-1",
          facet: "dish",
          normalized_value: "noodle_bowl",
          raw_value: "noodle bowl",
          confidence: 0.9,
          rank: 2,
          entity_id: null,
          metadata_jsonb: {},
        },
        {
          observation_id: "obs-2",
          facet: "ingredient_want",
          normalized_value: "chili_crunch",
          raw_value: "chili crunch",
          confidence: 0.85,
          rank: 1,
          entity_id: null,
          metadata_jsonb: {},
        },
        {
          observation_id: "obs-3",
          facet: "ingredient_want",
          normalized_value: "chili_crunch",
          raw_value: "chili crunch",
          confidence: 0.82,
          rank: 1,
          entity_id: null,
          metadata_jsonb: {},
        },
      ],
      outcomes: [
        {
          id: "out-1",
          observation_id: "obs-2",
          origin_observation_id: "obs-2",
          outcome_type: "recipe_committed",
          source_kind: "chat_commit",
          source_id: "commit-1",
          recipe_id: "recipe-1",
          variant_id: null,
          candidate_id: "candidate-1",
          occurred_at: new Date(now - 5 * 60 * 60 * 1000).toISOString(),
          payload_jsonb: {},
        },
        {
          id: "out-2",
          observation_id: "obs-2",
          origin_observation_id: "obs-2",
          outcome_type: "substitution_accepted",
          source_kind: "behavior_event",
          source_id: "event-1",
          recipe_id: "recipe-1",
          variant_id: "variant-1",
          candidate_id: null,
          occurred_at: new Date(now - 4 * 60 * 60 * 1000).toISOString(),
          payload_jsonb: {
            original: "butter",
            replacement: "olive oil",
          },
        },
      ],
      graphRows: [
        {
          id: "edge-1",
          from_facet: "goal",
          from_value: "high_protein",
          to_facet: "outcome",
          to_value: "recipe_committed",
          count: 4,
          recency_weighted_score: 2.6,
          acceptance_score: 0.5,
          segment_jsonb: { stage: "intent", source_kind: "chat_message" },
          last_observed_at: new Date(now - 4 * 60 * 60 * 1000).toISOString(),
          time_window: "30d",
        },
      ],
      jobs: [
        {
          status: "pending",
          observed_at: new Date(now - 60_000).toISOString(),
          updated_at: new Date(now - 30_000).toISOString(),
          next_attempt_at: new Date(now + 60_000).toISOString(),
          last_error: null,
        },
      ],
      observationTotal: 3,
      graphTotal: 1,
      pendingReviewCount: 1,
      reviewQueueRows: [],
    });

    expect(snapshot.summary.observations).toBe(3);
    expect(snapshot.summary.pendingReview).toBe(1);
    expect(snapshot.summary.queuePending).toBe(1);
    expect(snapshot.topIntentRows[0]).toMatchObject({
      facet: "ingredient_want",
      value: "chili_crunch",
      observations: 2,
    });
    expect(snapshot.risingIntentRows[0]).toMatchObject({
      facet: "ingredient_want",
      value: "chili_crunch",
    });
    expect(snapshot.unmetNeedRows[0]).toMatchObject({
      facet: "ingredient_want",
      value: "chili_crunch",
      successRate: 0.5,
    });
    expect(snapshot.outcomeRows.find((row) => row.outcomeType === "recipe_committed")?.count).toBe(1);
    expect(snapshot.substitutionRows[0]).toMatchObject({
      original: "butter",
      replacement: "olive oil",
      accepted: 1,
      reverted: 0,
    });
    expect(snapshot.graphRows[0]).toMatchObject({
      fromFacet: "goal",
      toValue: "recipe_committed",
    });
  });
});
