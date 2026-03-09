import React from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphVisualizer } from "./graph-visualizer";
import type { GraphData } from "./types";

vi.mock("@/components/admin/entity-type-icon", () => ({
  EntityTypeIcon: ({ entityType }: { entityType: string }) => <span data-testid={`entity-icon-${entityType}`} />,
}));

vi.mock("react-force-graph-2d", async () => {
  const ReactModule = await import("react");

  type MockForceGraphProps = {
    backgroundColor?: string;
  };

  const MockForceGraph = ReactModule.forwardRef(function MockForceGraph(
    props: MockForceGraphProps,
    ref: React.ForwardedRef<unknown>,
  ): React.JSX.Element {
    ReactModule.useImperativeHandle(ref, () => ({
      d3Force: () => ({
        strength: () => undefined,
        distanceMax: () => undefined,
        distance: () => undefined,
        iterations: () => undefined,
      }),
      d3ReheatSimulation: () => undefined,
      zoomToFit: () => undefined,
      centerAt: () => undefined,
    }));

    return <div data-testid="force-graph" data-background-color={props.backgroundColor ?? ""} />;
  });

  return {
    __esModule: true,
    default: MockForceGraph,
  };
});

const graph: GraphData = {
  entities: [
    { id: "recipe-1", entity_type: "recipe", label: "Spicy Tofu", metadata: {} },
    { id: "ingredient-1", entity_type: "ingredient", label: "Garlic", metadata: { family: "allium" } },
  ],
  edges: [
    {
      id: "edge-1",
      from_entity_id: "recipe-1",
      to_entity_id: "ingredient-1",
      from_label: "Spicy Tofu",
      to_label: "Garlic",
      relation_type: "contains_ingredient",
      confidence: 0.92,
      source: "metadata_pipeline",
    },
  ],
  relation_types: ["contains_ingredient"],
};

class ResizeObserverMock {
  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}
}

describe("GraphVisualizer", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the visual graph with themed dark-mode surfaces", () => {
    const { container } = render(<GraphVisualizer graph={graph} />);

    expect(screen.getByTestId("force-graph")).toHaveAttribute("data-background-color", "#020817");
    expect(screen.getByText("Filtered Graph")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fullscreen" })).toBeInTheDocument();
    expect(container.querySelector(".bg-white")).toBeNull();
    expect(container.querySelectorAll(".bg-card").length).toBeGreaterThanOrEqual(3);
  });
});
