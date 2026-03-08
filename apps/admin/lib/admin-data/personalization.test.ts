import { describe, expect, it } from "vitest";
import type { AnalyticsQueryState } from "@/lib/admin-analytics";
import { buildPersonalizationSnapshot } from "./personalization";

const query: AnalyticsQueryState = {
  range: "30d",
  grain: "day",
  compare: "none",
};

describe("buildPersonalizationSnapshot", () => {
  it("computes active-version lift, fallback rate, and breakdowns from feed + impression telemetry", () => {
    const now = Date.now();
    const snapshot = buildPersonalizationSnapshot({
      query,
      versions: [
        {
          version: "for_you_v2",
          status: "active",
          label: "For You v2",
          notes: null,
          novelty_policy: "balanced",
          config: { exploration_ratio: 0.2 },
          is_active: true,
          activated_at: new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString(),
          retired_at: null,
        },
        {
          version: "for_you_v1",
          status: "retired",
          label: "For You v1",
          notes: null,
          novelty_policy: "balanced",
          config: { exploration_ratio: 0.2 },
          is_active: false,
          activated_at: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(),
          retired_at: new Date(now - 4 * 24 * 60 * 60 * 1000).toISOString(),
        },
      ],
      feedServedRows: [
        {
          occurred_at: new Date(now - 2 * 60_000).toISOString(),
          user_id: "user-1",
          session_id: "feed-1",
          algorithm_version: "for_you_v2",
          payload: { profile_state: "warm", feed_latency_ms: 900, preset_id: null },
        },
        {
          occurred_at: new Date(now - 90_000).toISOString(),
          user_id: "user-2",
          session_id: "feed-2",
          algorithm_version: "for_you_v2",
          payload: { profile_state: "cold", feed_latency_ms: 1200, fallback_path: "rank_scope_failed", preset_id: "Healthy" },
        },
        {
          occurred_at: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString(),
          user_id: "user-3",
          session_id: "feed-3",
          algorithm_version: "for_you_v1",
          payload: { profile_state: "warm", feed_latency_ms: 1500, preset_id: null },
        },
      ],
      impressionRows: [
        {
          impression_occurred_at: new Date(now - 2 * 60_000).toISOString(),
          user_id: "user-1",
          feed_id: "feed-1",
          recipe_id: "recipe-1",
          algorithm_version: "for_you_v2",
          profile_state: "warm",
          preset_id: "for_you",
          fallback_path: null,
          why_tag_1: "Fits your weekday rhythm",
          why_tag_2: null,
          opened: true,
          skipped: false,
          hidden: false,
          saved: true,
          cooked: true,
        },
        {
          impression_occurred_at: new Date(now - 90_000).toISOString(),
          user_id: "user-2",
          feed_id: "feed-2",
          recipe_id: "recipe-2",
          algorithm_version: "for_you_v2",
          profile_state: "cold",
          preset_id: "Healthy",
          fallback_path: "rank_scope_failed",
          why_tag_1: "Quick cleanup",
          why_tag_2: null,
          opened: false,
          skipped: true,
          hidden: false,
          saved: false,
          cooked: false,
        },
        {
          impression_occurred_at: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString(),
          user_id: "user-3",
          feed_id: "feed-3",
          recipe_id: "recipe-3",
          algorithm_version: "for_you_v1",
          profile_state: "warm",
          preset_id: "for_you",
          fallback_path: null,
          why_tag_1: "Comfort leaning",
          why_tag_2: null,
          opened: true,
          skipped: false,
          hidden: false,
          saved: false,
          cooked: false,
        },
      ],
      tasteProfiles: [
        {
          user_id: "user-1",
          profile_state: "warm",
          algorithm_version: "for_you_v2",
          last_built_at: new Date(now - 4 * 60_000).toISOString(),
        },
        {
          user_id: "user-2",
          profile_state: "cold",
          algorithm_version: "for_you_v2",
          last_built_at: new Date(now - 3 * 60_000).toISOString(),
        },
      ],
      acquisitionProfiles: [
        {
          user_id: "user-1",
          acquisition_channel: "organic",
          lifecycle_stage: "habit",
          signed_in_at: new Date(now - 10 * 60_000).toISOString(),
        },
        {
          user_id: "user-2",
          acquisition_channel: "waitlist",
          lifecycle_stage: "activated",
          signed_in_at: new Date(now - 8 * 60_000).toISOString(),
        },
        {
          user_id: "user-3",
          acquisition_channel: "organic",
          lifecycle_stage: "saved",
          signed_in_at: new Date(now - 6 * 24 * 60 * 60 * 1000).toISOString(),
        },
      ],
    });

    expect(snapshot.summary.currentAlgorithmKey).toBe("for_you_v2");
    expect(snapshot.summary.saveLiftVsBaseline).toBe(0.5);
    expect(snapshot.summary.cookLiftVsBaseline).toBe(0.5);
    expect(snapshot.summary.fallbackRate).toBe(0.5);
    expect(snapshot.summary.personalizedFilterCoverage).toBe(0.5);
    expect(snapshot.summary.coldStartCoverage).toBe(0.5);
    expect(snapshot.summary.medianFeedLatencyMs).toBe(900);
    expect(snapshot.versionRows[0]).toMatchObject({
      version: "for_you_v2",
      isActive: true,
      saveRate: 0.5,
      cookRate: 0.5,
    });
    expect(snapshot.whyTagRows[0]).toMatchObject({
      tag: "Fits your weekday rhythm",
      impressions: 1,
    });
    expect(snapshot.presetRows.find((row) => row.preset === "Healthy")).toMatchObject({
      impressions: 1,
      saveRate: 0,
    });
  });
});
