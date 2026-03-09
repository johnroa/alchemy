import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GraphTablesPanel } from "./graph-tables-panel";

vi.mock("@/components/admin/entity-type-icon", () => ({
  EntityTypeIcon: ({ entityType }: { entityType: string }) => <span data-testid={`entity-icon-${entityType}`} />,
}));

const graph = {
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

const entityTypeColors = {
  recipe: "border-blue-400/40 bg-blue-500/10 text-blue-200",
  ingredient: "border-emerald-400/40 bg-emerald-500/10 text-emerald-200",
};

describe("GraphTablesPanel", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
  });

  it("uses themed surfaces for the table inspector sidebars", () => {
    const { container } = render(<GraphTablesPanel graph={graph} entityTypeColors={entityTypeColors} />);

    expect(screen.getByText("Entity Catalog")).toBeInTheDocument();
    expect(screen.getByText("Edge Snapshot")).toBeInTheDocument();
    expect(screen.getByText("Node Detail")).toBeInTheDocument();
    expect(container.querySelector(".bg-white")).toBeNull();
    expect(container.querySelectorAll(".bg-card").length).toBeGreaterThanOrEqual(4);
  });
});
