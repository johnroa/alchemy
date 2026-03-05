#!/usr/bin/env node

const apiBase = (process.env.API_URL ?? "https://api.cookwithalchemy.com/v1").replace(/\/+$/, "");
const bearerToken = process.env.API_BEARER_TOKEN ?? "";

if (!bearerToken) {
  console.error("Missing API_BEARER_TOKEN env var.");
  process.exit(1);
}

const request = async (path, options = {}) => {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${bearerToken}`,
      ...(options.headers ?? {})
    }
  });

  const bodyText = await response.text();
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = bodyText;
  }

  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
    error.response = body;
    throw error;
  }

  return body;
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
};

const run = async () => {
  const report = {
    started_at: new Date().toISOString(),
    api_base: apiBase,
    steps: []
  };

  const step = async (name, fn) => {
    const started = Date.now();
    try {
      const result = await fn();
      report.steps.push({
        name,
        status: "ok",
        latency_ms: Date.now() - started,
        result
      });
      return result;
    } catch (error) {
      report.steps.push({
        name,
        status: "failed",
        latency_ms: Date.now() - started,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  };

  const chat = await step("chat_start", async () => {
    const res = await request("/chat", {
      method: "POST",
      body: JSON.stringify({ message: "I want dinner ideas." })
    });
    assert(typeof res.id === "string", "chat id missing");
    return {
      chat_id: res.id,
      message_count: Array.isArray(res.messages) ? res.messages.length : 0,
      loop_state: res.loop_state,
      intent: res.response_context?.intent ?? null
    };
  });

  await step("chat_refine", async () => {
    const res = await request(`/chat/${chat.chat_id}/messages`, {
      method: "POST",
      body: JSON.stringify({
        message: "Give me a pescatarian gluten-free dinner with mushrooms and lemon."
      })
    });
    assert(Array.isArray(res.messages), "messages missing after tweak");
    return {
      message_count: res.messages.length,
      loop_state: res.loop_state,
      intent: res.response_context?.intent ?? null,
      candidate_count: Array.isArray(res.candidate_recipe_set?.components)
        ? res.candidate_recipe_set.components.length
        : 0
    };
  });

  const generated = await step("chat_generate_trigger", async () => {
    const res = await request(`/chat/${chat.chat_id}/messages`, {
      method: "POST",
      body: JSON.stringify({ message: "Generate the recipe now with a side." })
    });
    assert(Array.isArray(res.messages), "messages missing after attachment request");
    const candidateCount = Array.isArray(res.candidate_recipe_set?.components)
      ? res.candidate_recipe_set.components.length
      : 0;
    assert(candidateCount > 0, "candidate recipe set missing after trigger");
    return {
      message_count: res.messages.length,
      candidate_count: candidateCount,
      loop_state: res.loop_state,
      active_component_id: res.candidate_recipe_set?.active_component_id ?? null
    };
  });

  await step("chat_iterate_candidate", async () => {
    const res = await request(`/chat/${chat.chat_id}/messages`, {
      method: "POST",
      body: JSON.stringify({ message: "Make it spicier and quicker." })
    });
    const candidateCount = Array.isArray(res.candidate_recipe_set?.components)
      ? res.candidate_recipe_set.components.length
      : 0;
    assert(candidateCount > 0, "iteration lost candidate");
    return {
      loop_state: res.loop_state,
      candidate_count: candidateCount,
      active_component_id: res.candidate_recipe_set?.active_component_id ?? null
    };
  });

  const committed = await step("commit_candidate_set", async () => {
    const res = await request(`/chat/${chat.chat_id}/commit`, {
      method: "POST",
      body: JSON.stringify({})
    });
    const recipes = Array.isArray(res.commit?.recipes) ? res.commit.recipes : [];
    assert(recipes.length > 0, "commit returned zero recipes");
    return {
      committed_count: Number(res.commit?.committed_count ?? recipes.length),
      recipe_ids: recipes.map((item) => item.recipe_id),
      loop_state: res.loop_state,
      candidate_recipe_set: res.candidate_recipe_set ?? null
    };
  });

  await step("fetch_committed_recipe", async () => {
    const recipeId = Array.isArray(committed.recipe_ids) ? committed.recipe_ids[0] : null;
    assert(typeof recipeId === "string" && recipeId.length > 0, "missing committed recipe id");
    const res = await request(
      `/recipes/${recipeId}?units=metric&group_by=component&inline_measurements=true`
    );
    assert(typeof res.title === "string" && res.title.length > 0, "recipe title missing");
    return {
      recipe_id: recipeId,
      ingredient_count: Array.isArray(res.ingredients) ? res.ingredients.length : 0,
      step_count: Array.isArray(res.steps) ? res.steps.length : 0
    };
  });

  await step("fetch_cookbook", async () => {
    const res = await request("/recipes/cookbook");
    assert(Array.isArray(res.items), "cookbook items missing");
    return { item_count: res.items.length };
  });

  await step("fetch_changelog", async () => {
    const res = await request("/changelog");
    assert(Array.isArray(res.items), "changelog items missing");
    return { item_count: res.items.length };
  });

  await step("chat_out_of_scope_guard", async () => {
    const res = await request(`/chat/${chat.chat_id}/messages`, {
      method: "POST",
      body: JSON.stringify({ message: "Explain derivatives trading strategy." })
    });
    assert(res.response_context?.intent === "out_of_scope", "intent was not out_of_scope");
    assert(res.loop_state === "ideation", "loop_state should remain ideation for out_of_scope");
    return {
      intent: res.response_context?.intent ?? null,
      loop_state: res.loop_state,
      has_candidate: !!res.candidate_recipe_set
    };
  });

  report.completed_at = new Date().toISOString();
  report.status = "ok";
  console.log(JSON.stringify(report, null, 2));
};

run().catch((error) => {
  const failed = {
    status: "failed",
    error: error instanceof Error ? error.message : String(error)
  };
  console.error(JSON.stringify(failed, null, 2));
  process.exit(1);
});
