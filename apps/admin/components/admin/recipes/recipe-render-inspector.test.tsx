import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecipeRenderInspector } from "./recipe-render-inspector";

const previewPayload = {
  source: {
    kind: "canonical",
    label: "Canonical",
  },
  options: {
    units: "imperial",
    group_by: "component",
    inline_measurements: true,
    temperature_unit: "fahrenheit",
  },
  previews: {
    concise: {
      id: "recipe-1",
      title: "Branzino",
      summary: "Fast fish dinner.",
      description: "A bright grilled fish.",
      servings: 2,
      ingredients: [
        {
          name: "olive oil",
          amount: 2,
          unit: "tbsp",
          display_amount: "2",
          preparation: null,
          category: "pantry",
          component: "main",
        },
      ],
      ingredient_groups: [
        {
          key: "main",
          label: "Main",
          ingredients: [
            {
              name: "olive oil",
              amount: 2,
              unit: "tbsp",
              display_amount: "2",
              preparation: null,
              category: "pantry",
              component: "main",
            },
          ],
        },
      ],
      steps: [{ index: 1, instruction: "Salt fish.", title: null, notes: null }],
      notes: null,
      pairings: [],
      image_url: null,
      image_status: "ready",
    },
    balanced: {
      id: "recipe-1",
      title: "Branzino",
      summary: "Fast fish dinner.",
      description: "A bright grilled fish.",
      servings: 2,
      ingredients: [
        {
          name: "olive oil",
          amount: 2,
          unit: "tbsp",
          display_amount: "2",
          preparation: null,
          category: "pantry",
          component: "main",
        },
      ],
      ingredient_groups: [
        {
          key: "main",
          label: "Main",
          ingredients: [
            {
              name: "olive oil",
              amount: 2,
              unit: "tbsp",
              display_amount: "2",
              preparation: null,
              category: "pantry",
              component: "main",
            },
          ],
        },
      ],
      steps: [{ index: 1, instruction: "Salt the fish and brush it with oil.", title: null, notes: null }],
      notes: null,
      pairings: [],
      image_url: null,
      image_status: "ready",
    },
    detailed: {
      id: "recipe-1",
      title: "Branzino",
      summary: "Fast fish dinner.",
      description: "A bright grilled fish.",
      servings: 2,
      ingredients: [
        {
          name: "olive oil",
          amount: 2,
          unit: "tbsp",
          display_amount: "2",
          preparation: null,
          category: "pantry",
          component: "main",
        },
      ],
      ingredient_groups: [
        {
          key: "main",
          label: "Main",
          ingredients: [
            {
              name: "olive oil",
              amount: 2,
              unit: "tbsp",
              display_amount: "2",
              preparation: null,
              category: "pantry",
              component: "main",
            },
          ],
        },
      ],
      steps: [{
        index: 1,
        instruction: "Salt the fish generously, brush it with oil, and let it sit briefly before grilling.",
        title: null,
        notes: null,
      }],
      notes: null,
      pairings: [],
      image_url: null,
      image_status: "ready",
    },
  },
};

describe("RecipeRenderInspector", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
    Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
      configurable: true,
      value: vi.fn(() => false),
    });
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(previewPayload), {
          status: 200,
          headers: { "content-type": "application/json" },
        })),
    );
  });

  it("renders grouped ingredients and a three-column verbosity comparison from the live preview route", async () => {
    render(
      <RecipeRenderInspector
        recipeId="recipe-1"
        cookbookEntries={[]}
      />,
    );

    expect(screen.getByText("Render Inspector")).toBeInTheDocument();
    expect(screen.getByText("Grouped Ingredients")).toBeInTheDocument();

    await screen.findByText("olive oil");
    await screen.findByText("Salt fish.");
    await screen.findByText("Salt the fish and brush it with oil.");
    await screen.findByText(
      "Salt the fish generously, brush it with oil, and let it sit briefly before grilling.",
    );

    expect(screen.getByText("Main")).toBeInTheDocument();
    expect(screen.getByText("Concise")).toBeInTheDocument();
    expect(screen.getByText("Balanced")).toBeInTheDocument();
    expect(screen.getByText("Detailed")).toBeInTheDocument();

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/admin/recipes/recipe-1/render?"),
        expect.objectContaining({ cache: "no-store" }),
      );
    });
  });

});
