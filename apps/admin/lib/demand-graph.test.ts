import { describe, expect, it } from "vitest";
import { buildDemandGraphVisualizerData } from "./demand-graph";

describe("buildDemandGraphVisualizerData", () => {
  it("adapts demand graph edges into the shared graph visualizer shape", () => {
    const result = buildDemandGraphVisualizerData([
      {
        fromFacet: "goal",
        fromValue: "high_protein",
        toFacet: "dish",
        toValue: "noodle_bowl",
        count: 14,
        recencyWeightedScore: 9.4,
        acceptanceScore: 0.62,
        stage: "intent",
        sourceKind: "chat_message",
        lastObservedAt: new Date("2026-03-08T12:00:00.000Z").toISOString(),
        timeWindow: "30d",
      },
      {
        fromFacet: "dish",
        fromValue: "noodle_bowl",
        toFacet: "outcome",
        toValue: "recipe_committed",
        count: 9,
        recencyWeightedScore: 7.1,
        acceptanceScore: 0.44,
        stage: "commit",
        sourceKind: "chat_commit",
        lastObservedAt: new Date("2026-03-08T13:00:00.000Z").toISOString(),
        timeWindow: "30d",
      },
    ]);

    expect(result.summary).toMatchObject({
      nodes: 3,
      edges: 2,
      facets: 3,
      relationTypes: 2,
      sourceKinds: 2,
      window: "30d",
    });

    expect(result.graph.entities.map((entity) => entity.id)).toEqual([
      "dish:noodle_bowl",
      "goal:high_protein",
      "outcome:recipe_committed",
    ]);
    expect(result.graph.relation_types).toEqual(["Commit", "Intent"]);
    expect(result.graph.edges[0]).toMatchObject({
      from_entity_id: "goal:high_protein",
      to_entity_id: "dish:noodle_bowl",
      relation_type: "Intent",
      source: "Chat Message",
    });
    expect(result.graph.entities[0]?.metadata).toMatchObject({
      facet: "dish",
      normalized_value: "noodle_bowl",
      connected_edges: 2,
      total_count: 23,
    });
  });
});
