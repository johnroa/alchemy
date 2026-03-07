/**
 * Alchemy API — Deno Edge Function entry point.
 *
 * This is a thin router that:
 *   1. Authenticates the request
 *   2. Dispatches to the appropriate route handler
 *   3. Wires dependency-injection deps from lib/ modules
 *
 * All business logic lives in lib/ and routes/ subdirectories.
 */
import { requireAuth } from "../_shared/auth.ts";
import {
  ApiError,
  errorResponse,
  jsonResponse,
  requireJsonBody,
} from "../_shared/errors.ts";
import { createServiceClient, createUserClient } from "../_shared/db.ts";
import type { ModelOverrideMap } from "../_shared/llm-gateway.ts";
import type { JsonValue } from "../_shared/types.ts";
import { resolvePresentationOptions } from "./recipe-standardization.ts";
import {
  type ImageSimulationCompareRequest,
  runImageSimulationCompare,
  streamImageSimulationCompare,
} from "./image-simulations.ts";
import {
  backfillRecipeSearchDocuments,
  searchRecipes,
} from "./recipe-search.ts";
import {
  attachCommittedCandidateImages,
  enrollCandidateImageRequests,
  ensurePersistedRecipeImageRequest,
  hydrateCandidateRecipeSetImages,
  processImageJobs as processCandidateImageJobs,
} from "./recipe-image-pipeline.ts";

// ── Route handlers ──
import { handleChatRoutes } from "./routes/chat.ts";
import { handleGraphRoutes } from "./routes/graph.ts";
import { handleMemoryRoutes } from "./routes/memory.ts";
import { handleMetadataRoutes } from "./routes/metadata.ts";
import { handleOnboardingRoutes } from "./routes/onboarding.ts";
import { handleImportRoutes } from "./routes/import.ts";
import { handleInstallTelemetryRoutes } from "./routes/install-telemetry.ts";
import { handleRecipeRoutes } from "./routes/recipes.ts";
import { handleTelemetryRoutes } from "./routes/telemetry.ts";

// ── Extracted lib modules ──
import { normalizePath, getLimit, parseUuid } from "./lib/routing-utils.ts";
import {
  type PreferenceContext,
  computePreferenceFingerprint,
  buildSafetyExclusions,
  markUserVariantsStale,
  logPreferenceChanges,
  getPreferences,
  normalizePreferencePatch,
  normalizePreferencePatchWithLlm,
  applyModelPreferenceUpdates,
  buildNaturalLanguagePreferenceContext,
} from "./lib/preferences.ts";
import { computeVariantTags, flattenVariantTags } from "./lib/variant-tags.ts";
import { fetchGraphSubstitutions } from "./lib/graph-substitutions.ts";
import {
  extractChatContext,
  normalizeCandidateRecipeSet,
  deriveLoopState,
  toJsonValue,
} from "./lib/chat-types.ts";
import {
  extractOnboardingStateFromPreferences,
  deriveOnboardingStateFromPreferences,
} from "./lib/onboarding-helpers.ts";
import {
  ensureUserProfile,
  getMemorySnapshot,
  getActiveMemories,
  logChangelog,
  resolveRelationTypeId,
} from "./lib/user-profile.ts";
import { parseCsvParam } from "./lib/recipe-enrichment.ts";
import { enqueueRecipeMetadataJob, processMetadataJobs } from "./lib/metadata-pipeline.ts";
import {
  scheduleMetadataQueueDrain,
  scheduleImageQueueDrain,
  fetchGraphNeighborhood,
} from "./lib/background-tasks.ts";
import {
  fetchRecipeView,
  persistRecipe,
  deriveAttachmentPayload,
} from "./lib/recipe-persistence.ts";
import { buildContextPack, updateMemoryFromInteraction, enqueueMemoryJob, processMemoryJobs } from "./lib/context-pack.ts";
import {
  fetchChatMessages,
  extractLatestAssistantReply,
  resolveAssistantMessageContent,
  buildThreadForPrompt,
  buildCandidateOutlineForPrompt,
  updateChatSessionLoopContext,
  buildChatLoopResponse,
  mapCandidateRoleToRelation,
  buildCookbookItems,
  buildCookbookInsightDeterministic,
  orchestrateChatTurn,
} from "./lib/chat-orchestration.ts";

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID();
  const requestStartedAt = Date.now();
  const respond = (status: number, body: unknown): Response => {
    const response = jsonResponse(status, body);
    response.headers.set("x-request-id", requestId);
    response.headers.set("x-alchemy-request-id", requestId);
    response.headers.set(
      "x-alchemy-server-ms",
      String(Math.max(0, Date.now() - requestStartedAt)),
    );
    return response;
  };

  try {
    const url = new URL(request.url);
    const rawSegments = normalizePath(url.pathname);
    const segments = [...rawSegments];
    const method = request.method.toUpperCase();

    if (
      segments.length === 1 && segments[0] === "healthz" && method === "GET"
    ) {
      return respond(200, {
        status: "ok",
        service: "alchemy-api",
        timestamp: new Date().toISOString(),
        request_id: requestId,
      });
    }

    if (
      segments.length === 2 &&
      segments[0] === "telemetry" &&
      segments[1] === "install"
    ) {
      const serviceClient = createServiceClient();
      const installTelemetryResponse = await handleInstallTelemetryRoutes({
        request,
        segments,
        method,
        serviceClient,
        respond,
      });
      if (installTelemetryResponse) {
        return installTelemetryResponse;
      }
    }

    const auth = await requireAuth(request);
    const client = createUserClient(auth.authHeader);
    const serviceClient = createServiceClient();

    let modelOverrides: ModelOverrideMap | undefined;
    const simOverridesHeader = request.headers.get("x-sim-model-overrides");
    if (simOverridesHeader) {
      try {
        modelOverrides = JSON.parse(simOverridesHeader) as ModelOverrideMap;
      } catch {
        // ignore malformed override header
      }
    }
    await ensureUserProfile(client, {
      userId: auth.userId,
      email: auth.email,
      fullName: auth.fullName,
      avatarUrl: auth.avatarUrl,
    });

    const routeContext = {
      request,
      url,
      segments,
      method,
      requestId,
      auth,
      client,
      serviceClient,
      respond,
      modelOverrides,
    };

    const telemetryResponse = await handleTelemetryRoutes(routeContext);
    if (telemetryResponse) {
      return telemetryResponse;
    }

    // ── GET/PATCH /preferences ──
    if (segments.length === 1 && segments[0] === "preferences") {
      if (method === "GET") {
        const preferences = await getPreferences(client, auth.userId);
        // Include extended_preferences (JSONB column from migration 0043)
        // in the client response. This field is not part of the internal
        // PreferenceContext type because LLM pipelines don't need it —
        // it's only consumed by the iOS preferences UI.
        const { data: extRow } = await client
          .from("preferences")
          .select("extended_preferences")
          .eq("user_id", auth.userId)
          .maybeSingle();
        return respond(200, {
          ...preferences,
          extended_preferences: extRow?.extended_preferences ?? {},
        });
      }

      if (method === "PATCH") {
        const body = await requireJsonBody<Record<string, unknown>>(request);
        const patch = normalizePreferencePatch(body);
        if (!patch) {
          throw new ApiError(
            400,
            "invalid_preferences_payload",
            "No valid preference fields were provided",
          );
        }

        const normalizedPatch = await normalizePreferencePatchWithLlm({
          client: serviceClient,
          userId: auth.userId,
          requestId,
          patch,
        });

        const currentPreferences = await getPreferences(client, auth.userId);
        const nextPreferences: PreferenceContext = {
          ...currentPreferences,
          ...normalizedPatch,
        };

        const payload = {
          user_id: auth.userId,
          ...nextPreferences,
          updated_at: new Date().toISOString(),
        };
        const { data, error } = await client.from("preferences").upsert(payload)
          .select("*").single();
        if (error) {
          throw new ApiError(
            500,
            "preferences_update_failed",
            "Could not update preferences",
            error.message,
          );
        }

        await logChangelog({
          serviceClient,
          actorUserId: auth.userId,
          scope: "preferences",
          entityType: "preferences",
          entityId: auth.userId,
          action: "updated",
          requestId,
          afterJson: data as unknown as JsonValue,
        });

        const { hasConstraintChange } = await logPreferenceChanges({
          serviceClient,
          userId: auth.userId,
          before: currentPreferences,
          after: nextPreferences,
          source: "settings",
        });

        if (hasConstraintChange) {
          await markUserVariantsStale(serviceClient, auth.userId);
        }

        return respond(200, data);
      }
    }

    // ── Onboarding routes ──
    const onboardingResponse = await handleOnboardingRoutes(routeContext, {
      getPreferences,
      extractOnboardingStateFromPreferences,
      deriveOnboardingStateFromPreferences,
      buildContextPack,
      applyModelPreferenceUpdates,
      updateMemoryFromInteraction,
      logChangelog,
    });
    if (onboardingResponse) {
      return onboardingResponse;
    }

    // ── Memory routes ──
    const memoryResponse = await handleMemoryRoutes(routeContext, {
      getActiveMemories,
      getMemorySnapshot,
      getLimit,
      parseUuid,
      logChangelog,
      processMemoryJobs,
    });
    if (memoryResponse) {
      return memoryResponse;
    }

    // ── POST /image-simulations/compare ──
    if (
      segments.length === 2 && segments[0] === "image-simulations" &&
      segments[1] === "compare" && method === "POST"
    ) {
      const body = await requireJsonBody<ImageSimulationCompareRequest>(request);
      const stream = new URL(request.url).searchParams.get("stream") === "1";
      if (stream) {
        return streamImageSimulationCompare({
          client: serviceClient,
          userId: auth.userId,
          requestId,
          body,
        });
      }
      const response = await runImageSimulationCompare({
        client: serviceClient,
        userId: auth.userId,
        requestId,
        body,
      });
      return respond(200, response);
    }

    // ── Metadata routes ──
    const metadataResponse = await handleMetadataRoutes(routeContext, {
      parseUuid,
      logChangelog,
      processImageJobs: async (input) => {
        return await processCandidateImageJobs({
          serviceClient: input.serviceClient,
          userId: input.userId,
          requestId: input.requestId,
          limit: input.limit,
        });
      },
      processMetadataJobs,
      backfillRecipeSearchDocuments: async (input) => {
        return await backfillRecipeSearchDocuments({
          serviceClient: input.serviceClient,
          userId: input.userId,
          requestId: input.requestId,
          recipeIds: input.recipeIds,
          recipeVersionIds: input.recipeVersionIds,
          publicOnly: input.publicOnly,
          currentVersionsOnly: input.currentVersionsOnly,
          missingOnly: input.missingOnly,
          limit: input.limit,
        });
      },
      enqueueRecipeMetadataJob,
      scheduleMetadataQueueDrain,
    });
    if (metadataResponse) {
      return metadataResponse;
    }

    // ── POST /popularity/refresh ──
    if (
      segments.length === 2 &&
      segments[0] === "popularity" &&
      segments[1] === "refresh" &&
      method === "POST"
    ) {
      const { data, error } = await serviceClient.rpc(
        "refresh_recipe_popularity_stats",
      );
      if (error) {
        throw new ApiError(
          500,
          "popularity_refresh_failed",
          "Could not refresh popularity stats",
          error.message,
        );
      }
      return respond(200, data);
    }

    // ── GET /ingredients/trending ──
    if (
      segments.length === 2 &&
      segments[0] === "ingredients" &&
      segments[1] === "trending" &&
      method === "GET"
    ) {
      const sortParam = url.searchParams.get("sort") ?? "trending";
      const orderColumn = sortParam === "momentum"
        ? "momentum_score"
        : "trending_score";
      const limitParam = Math.max(
        1,
        Math.min(Number(url.searchParams.get("limit")) || 20, 100),
      );

      const { data, error } = await serviceClient
        .from("ingredient_trending_stats")
        .select("*")
        .order(orderColumn, { ascending: false })
        .limit(limitParam);

      if (error) {
        throw new ApiError(
          500,
          "ingredient_trending_failed",
          "Could not fetch trending ingredients",
          error.message,
        );
      }

      return respond(200, { items: data ?? [] });
    }

    // ── GET /observability/pipeline ──
    if (
      segments.length === 2 &&
      segments[0] === "observability" &&
      segments[1] === "pipeline" &&
      method === "GET"
    ) {
      const hours = Math.max(
        1,
        Math.min(Number(url.searchParams.get("hours")) || 24, 720),
      );
      const { data, error } = await serviceClient.rpc(
        "get_pipeline_observability_stats",
        { p_hours: hours },
      );
      if (error) {
        throw new ApiError(
          500,
          "observability_fetch_failed",
          "Could not fetch pipeline observability stats",
          error.message,
        );
      }
      return respond(200, data);
    }

    // ── Recipe routes ──
    const recipeResponse = await handleRecipeRoutes(routeContext, {
      parseUuid,
      getPreferences,
      resolvePresentationOptions,
      fetchRecipeView,
      fetchChatMessages,
      buildContextPack,
      deriveAttachmentPayload,
      persistRecipe,
      resolveRelationTypeId,
      logChangelog,
      buildCookbookItems,
      buildCookbookInsightDeterministic,
      ensurePersistedRecipeImageRequest,
      scheduleImageQueueDrain,
      searchRecipes: async (input) => {
        return await searchRecipes({
          serviceClient: input.serviceClient,
          userId: input.userId,
          requestId: input.requestId,
          surface: input.surface,
          query: input.query,
          presetId: input.presetId,
          cursor: input.cursor,
          limit: input.limit,
          sortBy: input.sortBy,
        });
      },
      toJsonValue,
      computePreferenceFingerprint,
      computeSafetyExclusions: buildSafetyExclusions,
      computeVariantTags,
      fetchGraphSubstitutions,
    });
    if (recipeResponse) {
      return recipeResponse;
    }

    // ── Graph routes ──
    const graphResponse = await handleGraphRoutes(routeContext, {
      parseUuid,
      parseCsvParam,
      fetchGraphNeighborhood,
      resolveRelationTypeId,
      logChangelog,
    });
    if (graphResponse) {
      return graphResponse;
    }

    // ── Import routes (must precede chat — both match segments[0] === "chat") ──
    const importResponse = await handleImportRoutes(routeContext, {
      updateChatSessionLoopContext,
      resolveAssistantMessageContent,
      logChangelog,
      buildChatLoopResponse,
      enrollCandidateImageRequests: async (input) => {
        return await enrollCandidateImageRequests({
          serviceClient: input.serviceClient,
          userId: input.userId,
          requestId: input.requestId,
          chatId: input.chatId,
          candidateSet: input.candidateSet,
        });
      },
      scheduleImageQueueDrain,
    });
    if (importResponse) {
      return importResponse;
    }

    // ── Chat routes ──
    const chatResponse = await handleChatRoutes(routeContext, {
      buildContextPack,
      buildThreadForPrompt,
      orchestrateChatTurn,
      updateChatSessionLoopContext,
      resolveAssistantMessageContent,
      enqueueMemoryJob,
      logChangelog,
      buildChatLoopResponse,
      extractChatContext,
      extractLatestAssistantReply,
      normalizeCandidateRecipeSet,
      hydrateCandidateRecipeSetImages: async (input) => {
        return await hydrateCandidateRecipeSetImages({
          serviceClient: input.serviceClient,
          chatId: input.chatId,
          candidateSet: input.candidateSet,
        });
      },
      enrollCandidateImageRequests: async (input) => {
        return await enrollCandidateImageRequests({
          serviceClient: input.serviceClient,
          userId: input.userId,
          requestId: input.requestId,
          chatId: input.chatId,
          candidateSet: input.candidateSet,
        });
      },
      attachCommittedCandidateImages: async (input) => {
        await attachCommittedCandidateImages({
          serviceClient: input.serviceClient,
          userId: input.userId,
          requestId: input.requestId,
          chatId: input.chatId,
          candidateSet: input.candidateSet,
          committedRecipes: input.committedRecipes,
        });
      },
      deriveLoopState,
      buildCandidateOutlineForPrompt,
      parseUuid,
      persistRecipe,
      scheduleImageQueueDrain,
      mapCandidateRoleToRelation,
      resolveRelationTypeId,
      fetchChatMessages,
    });
    if (chatResponse) {
      return chatResponse;
    }

    throw new ApiError(
      404,
      "route_not_found",
      "Requested route does not exist",
    );
  } catch (error) {
    const response = errorResponse(requestId, error);
    response.headers.set("x-request-id", requestId);
    response.headers.set("x-alchemy-request-id", requestId);
    response.headers.set(
      "x-alchemy-server-ms",
      String(Math.max(0, Date.now() - requestStartedAt)),
    );
    return response;
  }
});
