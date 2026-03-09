import { createServiceClient } from "../../../_shared/db.ts";
import { llmGateway } from "../../../_shared/llm-gateway.ts";
import type { RouteContext } from "../shared.ts";
import { logChatRouteTiming } from "./timing.ts";

/**
 * GET /chat/greeting
 *
 * Generates a time-of-day–aware LLM greeting for the authenticated user,
 * optionally referencing their most recently created recipe.
 * Uses the client's X-Timezone header to localize the time-of-day bucket.
 */
export const handleGreeting = async (
  context: RouteContext,
): Promise<Response> => {
  const routeStartedAt = Date.now();
  const { request, auth, client, serviceClient, requestId, respond } = context;

  const userName = auth.fullName;
  // Prefer the client's timezone (via X-Timezone header) so the greeting
  // matches the user's local time, not UTC server time.
  const clientTz = request.headers.get("x-timezone") ?? "UTC";
  let hour: number;
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: clientTz,
      hour: "numeric",
      hour12: false,
    });
    hour = parseInt(formatter.format(new Date()), 10);
  } catch {
    hour = new Date().getUTCHours();
  }
  const timeOfDay = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";

  const contextLoadStartedAt = Date.now();
  const { data: recentRecipe } = await client
    .from("recipes")
    .select("title")
    .eq("user_id", auth.userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const contextLoadMs = Date.now() - contextLoadStartedAt;

  const lastRecipeTitle = recentRecipe && typeof recentRecipe.title === "string"
    ? recentRecipe.title
    : null;

  const llmStartedAt = Date.now();
  const greeting = await llmGateway.generateGreeting({
    client: createServiceClient(),
    userId: auth.userId,
    requestId,
    userName,
    timeOfDay,
    lastRecipeTitle,
  });
  const llmMs = Date.now() - llmStartedAt;

  await logChatRouteTiming({
    serviceClient,
    userId: auth.userId,
    requestId,
    route: "chat_greeting",
    contextLoadMs,
    memoryRetrievalMs: 0,
    llmMs,
    recoveryPath: null,
    cacheHit: false,
    generationReusedContext: false,
    totalServerMs: Date.now() - routeStartedAt,
  });

  return respond(200, greeting);
};
