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

  const draft = await step("create_draft", async () => {
    const res = await request("/recipe-drafts", {
      method: "POST",
      body: JSON.stringify({ message: "chicken parm" })
    });
    assert(typeof res.id === "string", "draft id missing");
    return { draft_id: res.id, message_count: Array.isArray(res.messages) ? res.messages.length : 0 };
  });

  await step("draft_message_tweak", async () => {
    const res = await request(`/recipe-drafts/${draft.draft_id}/messages`, {
      method: "POST",
      body: JSON.stringify({ message: "what can i add to make it spicy?" })
    });
    assert(Array.isArray(res.messages), "messages missing after tweak");
    return { message_count: res.messages.length };
  });

  await step("draft_message_attachment", async () => {
    const res = await request(`/recipe-drafts/${draft.draft_id}/messages`, {
      method: "POST",
      body: JSON.stringify({ message: "add a side and appetizer and attach them" })
    });
    assert(Array.isArray(res.messages), "messages missing after attachment request");
    return { message_count: res.messages.length };
  });

  const finalized = await step("finalize_draft", async () => {
    const res = await request(`/recipe-drafts/${draft.draft_id}/finalize`, { method: "POST" });
    assert(res.recipe?.id, "finalized recipe id missing");
    return {
      recipe_id: res.recipe.id,
      attachment_count: Array.isArray(res.recipe.attachments) ? res.recipe.attachments.length : 0,
      image_status: res.recipe.image_status
    };
  });

  await step("save_recipe", async () => {
    const res = await request(`/recipes/${finalized.recipe_id}/save`, { method: "POST" });
    assert(res.saved === true, "recipe save failed");
    return res;
  });

  await step("fetch_recipe_history", async () => {
    const res = await request(`/recipes/${finalized.recipe_id}/history`);
    assert(Array.isArray(res.versions), "history missing versions");
    return { version_count: res.versions.length, draft_message_count: Array.isArray(res.draft_messages) ? res.draft_messages.length : 0 };
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
