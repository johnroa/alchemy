import { buildChatLoopResponse } from "./lib/chat-orchestration.ts";
import type {
  ChatMessageView,
  ChatSessionContext,
} from "./routes/shared.ts";

Deno.test("buildChatLoopResponse projects candidate recipes with live render preferences", () => {
  const context: ChatSessionContext = {
    loop_state: "candidate_presented",
    preferences: {
      free_form: null,
      dietary_preferences: [],
      dietary_restrictions: [],
      skill_level: "easy",
      equipment: [],
      cuisines: [],
      aversions: [],
      cooking_for: null,
      max_difficulty: 1,
      presentation_preferences: {
        recipe_units: "metric",
        recipe_group_by: "component",
        recipe_inline_measurements: true,
        recipe_instruction_verbosity: "concise",
        recipe_temperature_unit: "celsius",
      },
    },
    candidate_recipe_set: {
      candidate_id: "candidate-1",
      revision: 1,
      active_component_id: "component-1",
      components: [{
        component_id: "component-1",
        role: "main",
        title: "Roasted Carrots",
        image_url: null,
        image_status: "pending",
        recipe: {
          title: "Roasted Carrots",
          servings: 2,
          ingredients: [
            {
              name: "Carrots",
              amount: 1,
              unit: "lb",
              category: "Produce",
              component: "Vegetables",
            },
          ],
          steps: [{
            index: 1,
            instruction: "Roast the carrots until tender.",
            instruction_views: {
              concise: [
                { type: "text", value: "Roast at " },
                { type: "temperature", value: 425, unit: "fahrenheit" },
                { type: "text", value: "." },
              ],
            },
            inline_measurements: [
              { ingredient: "Olive Oil", amount: 2, unit: "tbsp" },
            ],
          }],
        },
      }],
    },
  };

  const messages: ChatMessageView[] = [];
  const response = buildChatLoopResponse({
    chatId: "chat-1",
    messages,
    context,
    memoryContextIds: [],
  });

  const candidate = response.candidate_recipe_set?.components[0];
  if (!candidate) {
    throw new Error("expected projected candidate response");
  }

  if (!candidate.recipe.ingredient_groups?.length) {
    throw new Error("expected ingredient groups to be projected on the server");
  }

  const instruction = candidate.recipe.steps[0]?.instruction ?? "";
  if (!instruction.includes("°C")) {
    throw new Error("expected temperature unit projection in candidate steps");
  }

  if (!instruction.includes("Olive Oil")) {
    throw new Error("expected inline measurements to be projected in candidate steps");
  }
});
