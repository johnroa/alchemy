/**
 * routes/import.ts — POST /chat/import
 *
 * Accepts a recipe source (URL, pasted text, or cookbook-page photo) and
 * returns a fully-seeded ChatSessionResponse. The imported recipe enters
 * the existing Generate flow (iteration via /chat/{id}/messages, commit
 * via /chat/{id}/commit) with no special handling downstream.
 *
 * Pipeline:
 *   1. Validate request, compute source fingerprint, check for dedup
 *   2. Extract → ImportedRecipeDocument (kind-specific)
 *   3. Transform → RecipePayload + AssistantReply (LLM)
 *   4. Seed chat session with CandidateRecipeSet
 *   5. Enroll image generation (always re-generate, never source images)
 *   6. Record provenance, emit telemetry, log changelog
 *   7. Return ChatLoopResponse
 */

import { ApiError, requireJsonBody } from "../../_shared/errors.ts";
import { executeScope, executeVisionScope } from "../../_shared/llm-executor.ts";
import type { VisionInputImage } from "../../_shared/llm-executor.ts";
import {
  scrapeRecipeFromUrl,
  documentFromRawText,
  ScraperError,
} from "../../_shared/recipe-scraper.ts";
import type {
  ImportedRecipeDocument,
  ImportRequest,
  ImportSourceKind,
  ImportTransformEnvelope,
  JsonValue,
  RecipePayload,
} from "../../_shared/types.ts";
import type {
  CandidateRecipeSet,
  ChatLoopResponse,
  ChatMessageView,
  ChatSessionContext,
  RouteContext,
} from "./shared.ts";

// ---------------------------------------------------------------------------
// Dependency injection (same pattern as ChatDeps in chat.ts)
// ---------------------------------------------------------------------------

export type ImportDeps = {
  updateChatSessionLoopContext: (input: {
    client: RouteContext["client"];
    chatId: string;
    context: ChatSessionContext;
  }) => Promise<void>;
  resolveAssistantMessageContent: (
    assistantReply: { text: string },
  ) => string;
  logChangelog: (input: {
    serviceClient: RouteContext["serviceClient"];
    actorUserId: string;
    scope: string;
    entityType: string;
    entityId?: string;
    action: string;
    requestId: string;
    afterJson?: JsonValue;
  }) => Promise<void>;
  buildChatLoopResponse: (input: {
    chatId: string;
    messages: ChatMessageView[];
    context: ChatSessionContext;
    assistantReply?: { text: string } | null;
    responseContext?: ChatLoopResponse["response_context"] | null;
    memoryContextIds: string[];
    createdAt?: string;
    updatedAt?: string;
    uiHints?: {
      show_generation_animation?: boolean;
      focus_component_id?: string;
    };
  }) => ChatLoopResponse;
  enrollCandidateImageRequests: (input: {
    serviceClient: RouteContext["serviceClient"];
    userId: string;
    requestId: string;
    chatId: string;
    candidateSet: CandidateRecipeSet;
  }) => Promise<CandidateRecipeSet>;
  scheduleImageQueueDrain: (input: {
    serviceClient: RouteContext["serviceClient"];
    actorUserId: string;
    requestId: string;
    limit?: number;
    modelOverrides?: RouteContext["modelOverrides"];
  }) => void;
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handleImportRoutes = async (
  context: RouteContext,
  deps: ImportDeps,
): Promise<Response | null> => {
  const {
    request,
    segments,
    method,
    auth,
    client,
    serviceClient,
    requestId,
    respond,
    modelOverrides,
  } = context;

  // Only match POST /chat/import
  if (
    !(segments.length === 2 &&
      segments[0] === "chat" &&
      segments[1] === "import" &&
      method === "POST")
  ) {
    return null;
  }

  const body = await requireJsonBody<ImportRequest>(request);
  validateImportRequest(body);

  const importStartedAt = Date.now();
  const kind: ImportSourceKind = body.kind;
  const origin = ("origin" in body ? body.origin : undefined) ?? "in_app";

  // ------------------------------------------------------------------
  // 1. Source fingerprint + dedup
  // ------------------------------------------------------------------
  const fingerprint = computeFingerprint(body);

  const { data: existingProvenance } = await serviceClient
    .from("import_provenance")
    .select("id,chat_session_id,status")
    .eq("user_id", auth.userId)
    .eq("source_fingerprint", fingerprint)
    .maybeSingle();

  // If a completed import with a valid chat session exists, return it.
  // This enables idempotent retry and re-share without duplicate sessions.
  if (
    existingProvenance?.status === "completed" &&
    existingProvenance.chat_session_id
  ) {
    const { data: existingSession } = await client
      .from("chat_sessions")
      .select("id,created_at,updated_at,context")
      .eq("id", existingProvenance.chat_session_id)
      .maybeSingle();

    if (existingSession) {
      const { data: existingMessages } = await client
        .from("chat_messages")
        .select("id,role,content,metadata,created_at")
        .eq("chat_id", existingSession.id)
        .order("created_at", { ascending: true })
        .limit(50);

      const ctx = (existingSession.context ?? {}) as ChatSessionContext;
      return respond(
        200,
        deps.buildChatLoopResponse({
          chatId: existingSession.id,
          messages: (existingMessages ?? []) as ChatMessageView[],
          context: ctx,
          assistantReply: null,
          responseContext: null,
          memoryContextIds: [],
          createdAt: existingSession.created_at,
          updatedAt: existingSession.updated_at,
          uiHints: ctx.candidate_recipe_set
            ? {
                show_generation_animation: false,
                focus_component_id:
                  ctx.candidate_recipe_set.active_component_id,
              }
            : undefined,
        }),
      );
    }
  }

  // ------------------------------------------------------------------
  // 2. Create provenance record (pending)
  // ------------------------------------------------------------------
  const { data: provenance, error: provError } = await serviceClient
    .from("import_provenance")
    .upsert(
      {
        user_id: auth.userId,
        source_fingerprint: fingerprint,
        source_kind: kind,
        source_url: kind === "url" ? (body as { url: string }).url : null,
        source_origin: origin,
        status: "pending",
        metadata: { request_id: requestId },
      },
      { onConflict: "user_id,source_fingerprint" },
    )
    .select("id")
    .single();

  if (provError || !provenance) {
    throw new ApiError(
      500,
      "import_provenance_failed",
      "Could not create import provenance record",
      provError?.message,
    );
  }

  // ------------------------------------------------------------------
  // 3. Extract → ImportedRecipeDocument
  // ------------------------------------------------------------------
  let extractedDoc: ImportedRecipeDocument;
  const extractStartedAt = Date.now();

  try {
    if (kind === "url") {
      const urlBody = body as { url: string };
      extractedDoc = await scrapeRecipeFromUrl(urlBody.url);
    } else if (kind === "text") {
      const textBody = body as { text: string };
      extractedDoc = documentFromRawText(textBody.text);
    } else if (kind === "photo") {
      const photoBody = body as { photo_asset_ref: string };
      extractedDoc = await extractFromPhoto(
        serviceClient,
        photoBody.photo_asset_ref,
      );
    } else {
      throw new ApiError(400, "invalid_import_kind", `Unknown import kind`);
    }
  } catch (err) {
    // Record failure in provenance
    const errorCode =
      err instanceof ScraperError
        ? err.code
        : err instanceof ApiError
          ? err.code
          : "extraction_failed";
    const errorMessage = err instanceof Error ? err.message : String(err);

    await serviceClient
      .from("import_provenance")
      .update({
        status: "failed",
        error_code: errorCode,
        error_message: errorMessage,
        updated_at: new Date().toISOString(),
      })
      .eq("id", provenance.id);

    await deps.logChangelog({
      serviceClient,
      actorUserId: auth.userId,
      scope: "import",
      entityType: "import_provenance",
      entityId: provenance.id,
      action: "import_failed",
      requestId,
      afterJson: {
        source_kind: kind,
        error_code: errorCode,
        error_message: errorMessage,
      },
    });

    if (err instanceof ScraperError || err instanceof ApiError) throw err;
    throw new ApiError(
      502,
      "extraction_failed",
      "Failed to extract recipe from source",
      errorMessage,
    );
  }

  const extractLatencyMs = Date.now() - extractStartedAt;

  // ------------------------------------------------------------------
  // 4. Transform → RecipePayload + AssistantReply
  // ------------------------------------------------------------------
  const transformStartedAt = Date.now();

  const transformResult = await executeScope<ImportTransformEnvelope>({
    client: serviceClient,
    scope: "recipe_import_transform",
    userInput: {
      imported_recipe: extractedDoc as unknown as JsonValue,
    },
  });

  const transformLatencyMs = Date.now() - transformStartedAt;
  const transformed = transformResult.parsed;
  const recipe: RecipePayload = transformed.recipe;
  const assistantReply = transformed.assistant_reply ?? {
    text: "Here's what I found! I've adapted this recipe for you. Feel free to make any changes.",
  };

  // ------------------------------------------------------------------
  // 5. Seed chat session with CandidateRecipeSet
  // ------------------------------------------------------------------
  const componentId = crypto.randomUUID();
  const candidateId = crypto.randomUUID();

  const candidateSet: CandidateRecipeSet = {
    candidate_id: candidateId,
    revision: 1,
    active_component_id: componentId,
    components: [
      {
        component_id: componentId,
        role: "main",
        title: recipe.title,
        image_url: null,
        image_status: "pending",
        recipe,
      },
    ],
  };

  const sessionContext: ChatSessionContext = {
    loop_state: "candidate_presented",
    candidate_recipe_set: candidateSet,
    candidate_revision: 1,
    active_component_id: componentId,
    pending_preference_conflict: null,
    thread_preference_overrides: null,
  };

  const { data: chatSession, error: chatError } = await client
    .from("chat_sessions")
    .insert({
      owner_user_id: auth.userId,
      context: sessionContext,
      source_kind: kind,
      import_provenance_id: provenance.id,
    })
    .select("id,created_at,updated_at")
    .single();

  if (chatError || !chatSession) {
    throw new ApiError(
      500,
      "import_chat_create_failed",
      "Could not create chat session for import",
      chatError?.message,
    );
  }

  // ------------------------------------------------------------------
  // 6. Enroll image generation (always re-generate)
  // ------------------------------------------------------------------
  let enrolledCandidateSet = candidateSet;
  enrolledCandidateSet = await deps.enrollCandidateImageRequests({
    serviceClient,
    userId: auth.userId,
    requestId,
    chatId: chatSession.id,
    candidateSet,
  });

  // Update context with enrolled image data
  sessionContext.candidate_recipe_set = enrolledCandidateSet;

  deps.scheduleImageQueueDrain({
    serviceClient,
    actorUserId: auth.userId,
    requestId,
    limit: 5,
    modelOverrides,
  });

  // ------------------------------------------------------------------
  // 7. Store assistant message
  // ------------------------------------------------------------------
  const assistantMessageContent = deps.resolveAssistantMessageContent(
    assistantReply,
  );

  const assistantMetadata: Record<string, JsonValue> = {
    format: "import_transform_v1",
    loop_state: "candidate_presented",
    source_kind: kind,
    extraction_strategy: extractedDoc.extractionStrategy,
    extraction_confidence: extractedDoc.confidence,
    envelope: {
      assistant_reply: assistantReply as unknown as JsonValue,
      trigger_recipe: true,
      candidate_recipe_set: enrolledCandidateSet as unknown as JsonValue,
      response_context: (transformed.response_context ?? {}) as JsonValue,
    },
  };

  const { data: assistantMessage, error: assistantMessageError } = await client
    .from("chat_messages")
    .insert({
      chat_id: chatSession.id,
      role: "assistant",
      content: assistantMessageContent,
      metadata: assistantMetadata,
    })
    .select("id,created_at")
    .single();

  if (assistantMessageError || !assistantMessage) {
    throw new ApiError(
      500,
      "import_assistant_message_failed",
      "Could not store import assistant message",
      assistantMessageError?.message,
    );
  }

  // ------------------------------------------------------------------
  // 8. Update session context + provenance
  // ------------------------------------------------------------------
  await deps.updateChatSessionLoopContext({
    client,
    chatId: chatSession.id,
    context: sessionContext,
  });

  await serviceClient
    .from("import_provenance")
    .update({
      status: "completed",
      chat_session_id: chatSession.id,
      extraction_strategy: extractedDoc.extractionStrategy,
      extraction_confidence: extractedDoc.confidence,
      metadata: {
        request_id: requestId,
        extract_latency_ms: extractLatencyMs,
        transform_latency_ms: transformLatencyMs,
        total_latency_ms: Date.now() - importStartedAt,
        source_site_name: extractedDoc.sourceSiteName ?? null,
        missing_fields: extractedDoc.missingFields,
        recipe_title: recipe.title,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", provenance.id);

  // ------------------------------------------------------------------
  // 9. Changelog + telemetry
  // ------------------------------------------------------------------
  await deps.logChangelog({
    serviceClient,
    actorUserId: auth.userId,
    scope: "import",
    entityType: "import_provenance",
    entityId: provenance.id,
    action: "import_created",
    requestId,
    afterJson: {
      source_kind: kind,
      source_origin: origin,
      extraction_strategy: extractedDoc.extractionStrategy,
      extraction_confidence: extractedDoc.confidence,
      chat_session_id: chatSession.id,
      recipe_title: recipe.title,
    },
  });

  // Emit import event for telemetry (picked up by admin dashboard + request trace)
  await serviceClient.from("events").insert({
    event_type: "import_completed",
    request_id: requestId,
    event_payload: {
      source_kind: kind,
      source_origin: origin,
      extraction_strategy: extractedDoc.extractionStrategy,
      extraction_confidence: extractedDoc.confidence,
      extract_latency_ms: extractLatencyMs,
      transform_latency_ms: transformLatencyMs,
      total_latency_ms: Date.now() - importStartedAt,
      fingerprint_cache_hit: Boolean(existingProvenance),
      recipe_title: recipe.title,
      missing_fields: extractedDoc.missingFields,
      source_url: extractedDoc.sourceUrl ?? null,
      source_site_name: extractedDoc.sourceSiteName ?? null,
    },
  });

  // ------------------------------------------------------------------
  // 10. Return ChatLoopResponse
  // ------------------------------------------------------------------
  const messages: ChatMessageView[] = [
    {
      id: assistantMessage.id,
      role: "assistant",
      content: assistantMessageContent,
      metadata: assistantMetadata,
      created_at: assistantMessage.created_at,
    },
  ];

  return respond(
    200,
    deps.buildChatLoopResponse({
      chatId: chatSession.id,
      messages,
      context: sessionContext,
      assistantReply,
      responseContext: transformed.response_context
        ? {
            mode: "import",
            intent: "in_scope_generate",
            ...transformed.response_context,
          }
        : { mode: "import", intent: "in_scope_generate" },
      memoryContextIds: [],
      createdAt: chatSession.created_at,
      updatedAt: new Date().toISOString(),
      uiHints: {
        show_generation_animation: true,
        focus_component_id: componentId,
      },
    }),
  );
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateImportRequest(body: ImportRequest): void {
  if (!body || typeof body !== "object" || !("kind" in body)) {
    throw new ApiError(400, "invalid_import_request", "Request must include 'kind'");
  }

  switch (body.kind) {
    case "url": {
      const url = (body as { url?: string }).url?.trim();
      if (!url) {
        throw new ApiError(400, "invalid_import_url", "URL is required for kind 'url'");
      }
      break;
    }
    case "text": {
      const text = (body as { text?: string }).text?.trim();
      if (!text) {
        throw new ApiError(400, "invalid_import_text", "Text is required for kind 'text'");
      }
      if (text.length > 50_000) {
        throw new ApiError(400, "import_text_too_long", "Text exceeds 50,000 character limit");
      }
      break;
    }
    case "photo": {
      const ref = (body as { photo_asset_ref?: string }).photo_asset_ref?.trim();
      if (!ref) {
        throw new ApiError(
          400,
          "invalid_import_photo",
          "photo_asset_ref is required for kind 'photo'",
        );
      }
      break;
    }
    default:
      throw new ApiError(
        400,
        "invalid_import_kind",
        `Unknown import kind: ${(body as Record<string, unknown>).kind}`,
      );
  }
}

// ---------------------------------------------------------------------------
// Fingerprint
// ---------------------------------------------------------------------------

/**
 * Computes a deterministic per-source fingerprint for dedup.
 * - URL: normalised URL (lowercase host, stripped tracking params)
 * - Text: first 500 chars lowercased + length
 * - Photo: storage ref as-is (already unique)
 */
function computeFingerprint(body: ImportRequest): string {
  switch (body.kind) {
    case "url": {
      try {
        const u = new URL(body.url.trim());
        // Strip common tracking params for better dedup
        u.searchParams.delete("utm_source");
        u.searchParams.delete("utm_medium");
        u.searchParams.delete("utm_campaign");
        u.searchParams.delete("utm_content");
        u.searchParams.delete("utm_term");
        u.searchParams.delete("fbclid");
        u.searchParams.delete("gclid");
        u.searchParams.sort();
        return `url:${u.hostname.toLowerCase()}${u.pathname}${u.search}`;
      } catch {
        return `url:${body.url.trim().toLowerCase()}`;
      }
    }
    case "text": {
      const normalised = body.text.trim().toLowerCase().slice(0, 500);
      return `text:${normalised.length}:${normalised}`;
    }
    case "photo":
      return `photo:${body.photo_asset_ref.trim()}`;
  }
}

// ---------------------------------------------------------------------------
// Photo extraction via vision LLM
// ---------------------------------------------------------------------------

/**
 * Extracts recipe data from a cookbook-page photo using the
 * recipe_import_vision_extract LLM scope.
 *
 * The photo_asset_ref should be a storage URL from the import-source-photos
 * bucket. The app uploads the photo before calling the import API.
 */
async function extractFromPhoto(
  serviceClient: RouteContext["serviceClient"],
  photoAssetRef: string,
): Promise<ImportedRecipeDocument> {
  // Resolve the photo URL. If the ref is already a full URL, use it directly.
  // Otherwise, build a Supabase Storage URL.
  let imageUrl = photoAssetRef;
  if (!imageUrl.startsWith("http")) {
    const { data: urlData } = serviceClient.storage
      .from("import-source-photos")
      .getPublicUrl(photoAssetRef);
    imageUrl = urlData.publicUrl;
  }

  const images: VisionInputImage[] = [
    { label: "cookbook_page", imageUrl },
  ];

  const result = await executeVisionScope<ImportedRecipeDocument>({
    client: serviceClient,
    scope: "recipe_import_vision_extract",
    userInput: {
      instruction:
        "Extract the recipe from this cookbook page or handwritten recipe image. Return a structured JSON document with title, ingredients (as an array of strings), instructions (as an array of strings), yields, prepTime, cookTime, and any other visible recipe information.",
    },
    images,
  });

  const doc = result.parsed;

  // Ensure required fields have defaults
  return {
    ...doc,
    ingredients: doc.ingredients ?? [],
    instructions: doc.instructions ?? [],
    confidence: doc.confidence ?? 0.7,
    missingFields: doc.missingFields ?? [],
    extractionStrategy: "vision",
  };
}
