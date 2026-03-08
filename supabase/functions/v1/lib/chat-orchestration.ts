/**
 * Chat orchestration logic — message parsing, candidate management,
 * cookbook assembly, and the main chat turn orchestrator.
 *
 * Data flow:
 *   User message → orchestrateChatTurn → LLM gateway (converseChat)
 *   → parse response → update candidate set / loop state / preferences
 *   → persist context → build ChatLoopResponse for client.
 *
 * Candidate recipe sets track multi-component recipes (main + sides/drinks)
 * across revisions within a single chat session. The orchestrator decides
 * whether to stay in ideation, escalate to generation, or iterate on an
 * existing candidate based on LLM intent signals.
 *
 * Cookbook items are assembled from cookbook_entries + canonical recipes +
 * variant statuses, producing the CookbookEntry shape consumed by clients.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { normalizeRecipeSemanticProfile } from "../../../../packages/shared/src/recipe-semantics.ts";
import { ApiError } from "../../_shared/errors.ts";
import type {
  AssistantReply,
  JsonValue,
  RecipePayload,
  PreferenceConflictContext,
} from "../../_shared/types.ts";
import { llmGateway, type ModelOverrideMap } from "../../_shared/llm-gateway.ts";
import {
  resolveRecipeImageStatus,
  resolveRecipeImageUrl,
} from "../recipe-images.ts";
import {
  buildHighestConfidenceCategoryMap,
  canonicalizeRecipePayloadMetadata,
  resolveCookbookPreviewCategory,
  resolveRecipePayloadSummary,
} from "../recipe-preview.ts";
import {
  applyThreadPreferenceOverrides,
  derivePendingPreferenceConflictFromResponse,
  mergeThreadPreferenceOverrides,
  normalizeChatStringList,
  normalizePendingPreferenceConflict,
  normalizeThreadPreferenceOverrides,
} from "../chat-preference-conflicts.ts";
import { sanitizeModelPreferencePatch } from "../preference-auto-update.ts";
import type {
  CookbookEntry,
  SuggestedChip,
  VariantStatus,
  VariantTagSet,
} from "../routes/shared.ts";
import type { PreferenceContext } from "./preferences.ts";
import {
  applyModelPreferenceUpdates,
  buildNaturalLanguagePreferenceContext,
  normalizePreferencePatchDeterministic,
  normalizePreferencePatch,
} from "./preferences.ts";
import {
  buildMatchedChipIds,
  buildSuggestedChips,
  extractSemanticProfileFromPayload,
  mergeSemanticProfiles,
} from "./semantic-facets.ts";
import { flattenVariantTags } from "./variant-tags.ts";
import type {
  ChatMessageView,
  CandidateRecipeSet,
  CandidateRecipeComponent,
  CandidateRecipeRole,
  ChatLoopState,
  ChatSessionContext,
  ChatLoopResponse,
  ChatIntent,
  ChatUiHints,
  ContextPack,
  RecipeView,
} from "./chat-types.ts";
import {
  normalizeCandidateRecipeSet,
  deriveLoopState,
  toJsonValue,
  extractChatContext,
  wrapRecipeInCandidateSet,
  normalizeCandidateRole,
} from "./chat-types.ts";

export const fetchChatMessages = async (
  client: SupabaseClient,
  chatId: string,
  limit = 80,
): Promise<ChatMessageView[]> => {
  const normalizedLimit = Math.max(1, Math.min(limit, 300));
  const { data: messages, error } = await client
    .from("chat_messages")
    .select("id,role,content,metadata,created_at")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: false })
    .limit(normalizedLimit);

  if (error) {
    throw new ApiError(
      500,
      "chat_messages_fetch_failed",
      "Could not fetch chat messages",
      error.message,
    );
  }

  return ((messages ?? []) as ChatMessageView[]).sort((a, b) =>
    a.created_at.localeCompare(b.created_at)
  );
};

const parseJsonRecordFromText = (
  text: string,
): Record<string, unknown> | null => {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const normalized = fencedMatch?.[1]?.trim() ?? trimmed;
  if (!normalized) {
    return null;
  }

  try {
    const parsed = JSON.parse(normalized) as unknown;
    if (
      parsed && typeof parsed === "object" &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return null;
};

const looksLikeStructuredAssistantPayload = (text: string): boolean => {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  return trimmed.startsWith("{") || trimmed.startsWith("[") ||
    trimmed.startsWith("```") || trimmed.includes("\"assistant_reply\"") ||
    trimmed.includes("\"candidate_recipe_set\"");
};

const extractAssistantTextFromUnknown = (
  value: unknown,
  depth = 0,
): string | null => {
  if (depth > 4 || value === null || typeof value === "undefined") {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = parseJsonRecordFromText(trimmed);
    if (parsed) {
      return extractAssistantTextFromUnknown(parsed, depth + 1);
    }
    return looksLikeStructuredAssistantPayload(trimmed) ? null : trimmed;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const nestedData = record.data && typeof record.data === "object" &&
      !Array.isArray(record.data)
    ? (record.data as Record<string, unknown>)
    : undefined;
  const nestedResult = record.result && typeof record.result === "object" &&
      !Array.isArray(record.result)
    ? (record.result as Record<string, unknown>)
    : undefined;

  const candidates: unknown[] = [
    record.assistant_reply,
    record.assistantReply,
    record.assistant,
    record.reply,
    nestedData?.assistant_reply,
    nestedData?.assistantReply,
    nestedData?.assistant,
    nestedResult?.assistant_reply,
    nestedResult?.assistantReply,
    nestedResult?.assistant,
    record.text,
  ];

  for (const candidate of candidates) {
    const extracted = extractAssistantTextFromUnknown(candidate, depth + 1);
    if (extracted) {
      return extracted;
    }
  }

  return null;
};

export const parseAssistantChatPayload = (
  message: Pick<ChatMessageView, "content" | "metadata">,
): {
  recipe: RecipePayload | null;
  assistantReply: AssistantReply | null;
  candidateSet: CandidateRecipeSet | null;
  responseContext: ChatLoopResponse["response_context"] | null;
} | null => {
  try {
    let parsed: unknown = null;
    const metadataEnvelope = message.metadata &&
        typeof message.metadata === "object" &&
        !Array.isArray(message.metadata)
      ? (message.metadata as Record<string, JsonValue>).envelope
      : null;

    if (
      metadataEnvelope &&
      typeof metadataEnvelope === "object" &&
      !Array.isArray(metadataEnvelope)
    ) {
      parsed = metadataEnvelope as unknown;
    } else {
      parsed = JSON.parse(message.content) as unknown;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const candidate = parsed as Record<string, unknown>;
    const envelopeRecipe = candidate.recipe as RecipePayload | undefined;

    const recipe = envelopeRecipe && envelopeRecipe.title &&
        Array.isArray(envelopeRecipe.ingredients) &&
        Array.isArray(envelopeRecipe.steps)
      ? envelopeRecipe
      : (() => {
        const directRecipe = parsed as RecipePayload;
        if (
          directRecipe && directRecipe.title &&
          Array.isArray(directRecipe.ingredients) &&
          Array.isArray(directRecipe.steps)
        ) {
          return directRecipe;
        }
        return null;
      })();
    const candidateSet =
      normalizeCandidateRecipeSet(candidate.candidate_recipe_set) ??
        (recipe ? wrapRecipeInCandidateSet(recipe) : null);

    const replyCandidate = candidate.assistant_reply ??
      ((candidate.data as Record<string, unknown> | undefined)
        ?.assistant_reply as unknown) ??
      ((candidate.result as Record<string, unknown> | undefined)
        ?.assistant_reply as unknown);
    const assistantReply = (() => {
      const safeText = extractAssistantTextFromUnknown(replyCandidate);
      if (!safeText) {
        return null;
      }

      const replyObject = replyCandidate &&
          typeof replyCandidate === "object" && !Array.isArray(replyCandidate)
        ? (replyCandidate as Record<string, unknown>)
        : null;

      const tone = replyObject && typeof replyObject.tone === "string" &&
          replyObject.tone.trim().length > 0
        ? replyObject.tone.trim()
        : undefined;
      const focusSummary = replyObject &&
          typeof replyObject.focus_summary === "string" &&
          replyObject.focus_summary.trim().length > 0
        ? replyObject.focus_summary.trim()
        : undefined;
      const emoji = replyObject && Array.isArray(replyObject.emoji)
        ? replyObject.emoji.filter((entry): entry is string =>
          typeof entry === "string"
        )
        : undefined;
      const suggestedNextActions = replyObject &&
          Array.isArray(replyObject.suggested_next_actions)
        ? replyObject.suggested_next_actions.filter((entry): entry is string =>
          typeof entry === "string"
        )
        : undefined;

      return {
        text: safeText,
        tone,
        focus_summary: focusSummary,
        emoji,
        suggested_next_actions: suggestedNextActions,
      } as AssistantReply;
    })();
    const rawResponseContext = candidate.response_context;
    const responseContext = rawResponseContext &&
        typeof rawResponseContext === "object" &&
        !Array.isArray(rawResponseContext)
      ? (() => {
        const raw = rawResponseContext as Record<string, unknown>;
        const intent = typeof raw.intent === "string" &&
            (
              raw.intent === "in_scope_ideation" ||
              raw.intent === "in_scope_generate" ||
              raw.intent === "out_of_scope"
            )
          ? (raw.intent as ChatIntent)
          : undefined;
        return {
          mode: typeof raw.mode === "string" ? raw.mode : undefined,
          intent,
          changed_sections: Array.isArray(raw.changed_sections)
            ? raw.changed_sections.filter((item): item is string =>
              typeof item === "string"
            )
            : undefined,
          personalization_notes: Array.isArray(raw.personalization_notes)
            ? raw.personalization_notes.filter((item): item is string =>
              typeof item === "string"
            )
            : undefined,
          preference_updates: raw.preference_updates &&
              typeof raw.preference_updates === "object" &&
              !Array.isArray(raw.preference_updates)
            ? (raw.preference_updates as Record<string, JsonValue>)
            : undefined,
          preference_conflict: raw.preference_conflict &&
              typeof raw.preference_conflict === "object" &&
              !Array.isArray(raw.preference_conflict)
            ? (() => {
              const conflict =
                raw.preference_conflict as Record<string, unknown>;
              const status = typeof conflict.status === "string" &&
                  (
                    conflict.status === "pending_confirmation" ||
                    conflict.status === "adapt" ||
                    conflict.status === "override" ||
                    conflict.status === "cleared"
                  )
                ? conflict.status
                : undefined;
              return {
                status,
                conflicting_preferences: normalizeChatStringList(
                  conflict.conflicting_preferences,
                ),
                conflicting_aversions: normalizeChatStringList(
                  conflict.conflicting_aversions,
                ),
                requested_terms: normalizeChatStringList(
                  conflict.requested_terms,
                ),
              } as PreferenceConflictContext;
            })()
            : undefined,
        };
      })()
      : null;

    if (!recipe && !assistantReply && !candidateSet && !responseContext) {
      return null;
    }

    return {
      recipe,
      assistantReply,
      candidateSet,
      responseContext,
    };
  } catch {
    return null;
  }

  return null;
};

export const extractLatestAssistantRecipe = (
  messages: ChatMessageView[],
): RecipePayload | null => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") {
      continue;
    }

    const parsed = parseAssistantChatPayload(message);
    if (parsed?.recipe) {
      return parsed.recipe;
    }
    if (parsed?.candidateSet?.components?.[0]?.recipe) {
      return parsed.candidateSet.components[0].recipe;
    }
  }

  return null;
};

export const extractLatestAssistantReply = (
  messages: ChatMessageView[],
): AssistantReply | null => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") {
      continue;
    }

    const parsed = parseAssistantChatPayload(message);
    if (parsed?.assistantReply) {
      return parsed.assistantReply;
    }
  }

  return null;
};

const sanitizeAssistantMessageContent = (
  message: ChatMessageView,
  fallbackReplyText?: string | null,
): string => {
  const parsed = parseAssistantChatPayload(message);
  const parsedText = parsed?.assistantReply?.text?.trim();
  if (parsedText && parsedText.length > 0) {
    const normalized = extractAssistantTextFromUnknown(parsedText);
    if (normalized) {
      return normalized;
    }
  }

  const fallback = typeof fallbackReplyText === "string"
      ? fallbackReplyText.trim()
      : ""
  ;
  if (fallback.length > 0) {
    const normalized = extractAssistantTextFromUnknown(fallback);
    if (normalized) {
      return normalized;
    }
  }

  const trimmed = message.content.trim();
  if (!trimmed) {
    return "...";
  }

  const extractedFromContent = extractAssistantTextFromUnknown(trimmed);
  if (extractedFromContent) {
    return extractedFromContent;
  }

  if (looksLikeStructuredAssistantPayload(trimmed)) {
    return "...";
  }

  return message.content;
};

const sanitizeMessagesForChatResponse = (
  messages: ChatMessageView[],
  assistantReply?: AssistantReply | null,
): ChatMessageView[] => {
  let latestAssistantIndex = -1;
  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index].role === "assistant") {
      latestAssistantIndex = index;
    }
  }

  return messages.map((message, index) => {
    if (message.role !== "assistant") {
      return message;
    }

    const safeContent = sanitizeAssistantMessageContent(
      message,
      index === latestAssistantIndex ? assistantReply?.text ?? null : null,
    );
    if (safeContent === message.content) {
      return message;
    }
    return {
      ...message,
      content: safeContent,
    };
  });
};

export const resolveAssistantMessageContent = (
  assistantReply: AssistantReply | null | undefined,
): string => {
  const normalized = extractAssistantTextFromUnknown(assistantReply);
  if (normalized && normalized.trim().length > 0) {
    return normalized.trim();
  }

  throw new ApiError(
    502,
    "chat_assistant_reply_missing",
    "Assistant reply text was missing from chat payload",
  );
};

const renderChatMessageForPrompt = (message: ChatMessageView): string => {
  if (message.role !== "assistant") {
    return message.content;
  }

  const parsed = parseAssistantChatPayload(message);
  if (parsed?.assistantReply?.text) {
    return parsed.assistantReply.text;
  }

  if (parsed?.recipe) {
    const summaryParts = [
      parsed.recipe.title,
      parsed.recipe.summary,
      parsed.recipe.notes,
    ].filter(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    );
    return summaryParts.join(" — ");
  }

  return message.content;
};

const truncatePromptText = (value: string, maxChars: number): string => {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
};

const normalizeChatIntent = (value: unknown): ChatIntent | null => {
  if (
    value === "in_scope_ideation" || value === "in_scope_generate" ||
    value === "out_of_scope"
  ) {
    return value;
  }
  return null;
};

const getChatIntentFromResponse = (
  response: Awaited<ReturnType<typeof llmGateway.converseChat>>,
): ChatIntent | null => normalizeChatIntent(response.response_context?.intent);

export const buildThreadForPrompt = (
  messages: ChatMessageView[],
  maxMessages = 6,
): Array<{ role: string; content: string }> => {
  const scoped = messages
    .filter((message) =>
      message.role === "user" || message.role === "assistant"
    )
    .slice(-maxMessages);

  return scoped.map((message) => ({
    role: message.role,
    content: truncatePromptText(renderChatMessageForPrompt(message), 900),
  }));
};

/**
 * Builds a natural-language instruction injected into the LLM context when the
 * chat session is a preference-editing workflow. This tells the model:
 * 1) Do NOT generate recipes — this is strictly a preferences conversation.
 * 2) Which preference category the user is editing.
 * 3) Ask probing follow-up questions to gather nuanced preferences.
 * 4) Emit preference_updates in response_context when the user states a preference.
 */
const buildPreferenceWorkflowInstruction = (
  context: ChatSessionContext,
): string => {
  const intent = context.preference_editing_intent as
    | { key?: string; title?: string; prompt?: string }
    | null;
  const category = intent?.title ?? "general preferences";
  const key = intent?.key ?? "unknown";

  return [
    `CRITICAL: This is a PREFERENCE EDITING session, NOT a recipe generation session.`,
    `The user is on the Preferences screen editing their "${category}" (key: ${key}).`,
    ``,
    `YOUR ROLE: You are a knowledgeable sous chef learning about the user's kitchen, lifestyle, and tastes so you can personalize every future recipe. You are NOT here to suggest dishes or menus.`,
    ``,
    `HOW TO RESPOND:`,
    `1. Acknowledge what the user told you with genuine expertise and enthusiasm.`,
    `2. Explain CONCRETELY how this preference will affect their recipes going forward. Examples:`,
    `   - Equipment: "That's a powerful oven — I'll adjust temperatures down ~25°F for most bakes and tell you exactly which oven mode to use per dish."`,
    `   - Dietary: "Got it — I'll never include shellfish and will always flag shared-equipment cross-contamination risks."`,
    `   - Cuisine: "Love it — I'll weight your feed toward those cuisines and pull authentic techniques into other dishes too."`,
    `   - Aversions: "Noted — cilantro is gone from every recipe. I'll suggest parsley or Thai basil as alternatives."`,
    `3. Ask a focused follow-up to deepen the preference — probe for nuance, boundaries, or related context.`,
    `   - "Do you usually use the convection or conventional oven for everyday cooking?"`,
    `   - "Any other equipment I should know about — stand mixer, sous vide, outdoor grill?"`,
    `4. When you have enough information, confirm what you saved and let them know: "All set — I've saved your ${category}. Tap another category or keep chatting!"`,
    ``,
    `STRICT RULES:`,
    `- NEVER ask "what are you thinking of cooking?" or suggest making a recipe.`,
    `- NEVER set trigger_recipe to true.`,
    `- NEVER return a candidate_recipe_set or recipe object.`,
    `- When the user states clear preferences, emit them as preference_updates in response_context.`,
    `- Keep every response focused on understanding and saving their ${category}.`,
  ].join("\n");
};

const buildCompactChatContext = (
  context: ChatSessionContext,
): Record<string, JsonValue> => ({
  loop_state: context.loop_state ?? "ideation",
  candidate_revision: context.candidate_revision ?? 0,
  active_component_id: context.active_component_id ?? null,
  workflow: context.workflow ?? null,
  entry_surface: context.entry_surface ?? null,
  preference_editing_intent: context.preference_editing_intent
    ? context.preference_editing_intent as unknown as JsonValue
    : null,
  pending_preference_conflict: context.pending_preference_conflict
    ? context.pending_preference_conflict as unknown as JsonValue
    : null,
  thread_preference_overrides: context.thread_preference_overrides
    ? context.thread_preference_overrides as unknown as JsonValue
    : null,
});

export const buildCandidateOutlineForPrompt = (
  candidate: CandidateRecipeSet | null,
): Record<string, JsonValue> | null => {
  if (!candidate) {
    return null;
  }

  return {
    candidate_id: candidate.candidate_id,
    revision: candidate.revision,
    active_component_id: candidate.active_component_id,
    components: candidate.components.map((component) => ({
      component_id: component.component_id,
      role: component.role,
      title: component.title,
      ingredient_count: Array.isArray(component.recipe.ingredients)
        ? component.recipe.ingredients.length
        : 0,
      step_count: Array.isArray(component.recipe.steps)
        ? component.recipe.steps.length
        : 0,
    })),
  };
};

export const updateChatSessionLoopContext = async (params: {
  client: SupabaseClient;
  chatId: string;
  context: ChatSessionContext;
}): Promise<void> => {
  const { error } = await params.client
    .from("chat_sessions")
    .update({
      context: params.context,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.chatId);

  if (error) {
    throw new ApiError(
      500,
      "chat_context_update_failed",
      "Could not update chat context",
      error.message,
    );
  }
};

export const buildChatLoopResponse = (params: {
  chatId: string;
  messages: ChatMessageView[];
  context: ChatSessionContext;
  assistantReply?: AssistantReply | null;
  responseContext?: ChatLoopResponse["response_context"] | null;
  memoryContextIds: string[];
  createdAt?: string;
  updatedAt?: string;
  uiHints?: ChatUiHints;
}): ChatLoopResponse => {
  const candidateSet = normalizeCandidateRecipeSet(
    params.context.candidate_recipe_set ?? null,
  );
  const loopState = deriveLoopState(params.context, candidateSet);
  const reply = params.assistantReply ??
    extractLatestAssistantReply(params.messages);
  const safeMessages = sanitizeMessagesForChatResponse(params.messages, reply);
  const responseContext = params.responseContext ??
    (() => {
      for (let index = params.messages.length - 1; index >= 0; index -= 1) {
        const message = params.messages[index];
        if (message.role !== "assistant") {
          continue;
        }
        return parseAssistantChatPayload(message)?.responseContext ?? null;
      }
      return null;
    })();

  return {
    id: params.chatId,
    messages: safeMessages,
    loop_state: loopState,
    assistant_reply: reply ?? null,
    candidate_recipe_set: candidateSet,
    response_context: responseContext ?? undefined,
    memory_context_ids: params.memoryContextIds,
    context_version: 2,
    ui_hints: params.uiHints,
    context: params.context as Record<string, JsonValue>,
    created_at: params.createdAt,
    updated_at: params.updatedAt,
  };
};

export const mapCandidateRoleToRelation = (role: CandidateRecipeRole): string => {
  switch (role) {
    case "side":
      return "is_side_of";
    case "appetizer":
      return "is_appetizer_of";
    case "dessert":
      return "is_dessert_of";
    case "drink":
      return "is_drink_of";
    case "main":
    default:
      return "pairs_with";
  }
};

const mapRelationTypeToCandidateRole = (
  relationType: string | null | undefined,
): CandidateRecipeRole => {
  const normalized = relationType?.trim().toLowerCase() ?? "";
  if (normalized === "is_side_of" || normalized === "side") return "side";
  if (normalized === "is_appetizer_of" || normalized === "appetizer") {
    return "appetizer";
  }
  if (normalized === "is_dessert_of" || normalized === "dessert") {
    return "dessert";
  }
  if (
    normalized === "is_drink_of" || normalized === "drink" ||
    normalized === "beverage"
  ) {
    return "drink";
  }
  return "main";
};

const removeRecipeAttachments = (recipe: RecipePayload): RecipePayload => ({
  ...recipe,
  attachments: [],
});

const candidateFromRecipePayload = (
  recipe: RecipePayload,
  existing: CandidateRecipeSet | null = null,
): CandidateRecipeSet => {
  const components: CandidateRecipeComponent[] = [
    {
      component_id: existing?.components?.[0]?.component_id ??
        crypto.randomUUID(),
      role: "main",
      title: recipe.title,
      image_url: null,
      image_status: "pending",
      recipe: removeRecipeAttachments(recipe),
    },
  ];

  for (const attachment of recipe.attachments ?? []) {
    if (components.length >= 3) break;
    if (!attachment?.recipe) continue;
    components.push({
      component_id: crypto.randomUUID(),
      role: mapRelationTypeToCandidateRole(attachment.relation_type),
      title: attachment.title?.trim() || attachment.recipe.title,
      image_url: null,
      image_status: "pending",
      recipe: removeRecipeAttachments(attachment.recipe as RecipePayload),
    });
  }

  const activeComponentId = existing?.active_component_id &&
      components.some((component) =>
        component.component_id === existing.active_component_id
      )
    ? existing.active_component_id
    : components[0].component_id;

  return {
    candidate_id: existing?.candidate_id ?? crypto.randomUUID(),
    revision: Math.max(1, Number(existing?.revision ?? 0) + 1),
    active_component_id: activeComponentId,
    components,
  };
};

const mergeRecipeIntoCandidate = (
  existing: CandidateRecipeSet | null,
  recipe: RecipePayload,
): CandidateRecipeSet => {
  if (!existing) {
    return candidateFromRecipePayload(recipe, null);
  }

  if (Array.isArray(recipe.attachments) && recipe.attachments.length > 0) {
    return candidateFromRecipePayload(recipe, existing);
  }

  const nextComponents = existing.components.map((component) => {
    if (component.component_id !== existing.active_component_id) {
      return component;
    }
    return {
      ...component,
      title: recipe.title,
      recipe: removeRecipeAttachments(recipe),
    };
  });

  return {
    ...existing,
    revision: Math.max(1, Number(existing.revision ?? 0) + 1),
    components: nextComponents,
  };
};

/**
 * Builds cookbook entries by reading from cookbook_entries (preferred) with
 * fallback to recipe_saves (legacy). Joins canonical recipe data with
 * variant status to produce the CookbookEntry shape.
 *
 * Data flow:
 *   cookbook_entries → recipe IDs → recipes + recipe_versions (canonical)
 *   → user_recipe_variants (variant status) → merge into CookbookEntry[]
 */
const buildCookbookData = async (
  client: SupabaseClient,
  userId: string,
): Promise<{ items: CookbookEntry[]; suggestedChips: SuggestedChip[] }> => {
  // Read from cookbook_entries (new table). Falls back to recipe_saves if
  // no cookbook_entries exist yet (pre-migration users).
  const { data: cookbookRows, error: cbError } = await client
    .from("cookbook_entries")
    .select(
      "canonical_recipe_id, autopersonalize, active_variant_id, saved_at, updated_at",
    )
    .eq("user_id", userId);

  if (cbError) {
    throw new ApiError(
      500,
      "cookbook_entries_fetch_failed",
      "Could not fetch cookbook entries",
      cbError.message,
    );
  }

  // After migration 0047, all recipe_saves are backfilled into
  // cookbook_entries. No fallback needed.
  const recipeIds = (cookbookRows ?? []).map((row) => row.canonical_recipe_id);
  const entryMap = new Map<
    string,
    {
      autopersonalize: boolean;
      active_variant_id: string | null;
      saved_at: string;
      updated_at: string;
    }
  >();

  for (const row of cookbookRows ?? []) {
    entryMap.set(row.canonical_recipe_id, {
      autopersonalize: row.autopersonalize ?? true,
      active_variant_id: row.active_variant_id,
      saved_at: row.saved_at ?? row.updated_at,
      updated_at: row.updated_at,
    });
  }

  if (recipeIds.length === 0) {
    return { items: [], suggestedChips: [] };
  }

  // Load canonical recipe data.
  const { data: recipesData, error: recipesError } = await client
    .from("recipes")
    .select(
      "id,title,hero_image_url,image_status,visibility,updated_at,current_version_id",
    )
    .in("id", recipeIds)
    .order("updated_at", { ascending: false });

  if (recipesError) {
    throw new ApiError(
      500,
      "cookbook_fetch_failed",
      "Could not load cookbook recipes",
      recipesError.message,
    );
  }

  const recipes = (recipesData ?? []) as Array<{
    id: string;
    title: string;
    hero_image_url: string | null;
    image_status: string;
    visibility: string;
    updated_at: string;
    current_version_id: string | null;
  }>;

  // Load canonical version payloads for summaries and metadata.
  const versionIds = recipes
    .map((r) => r.current_version_id)
    .filter((id): id is string => Boolean(id));

  let versionById = new Map<string, RecipePayload>();
  if (versionIds.length > 0) {
    const { data: versions, error: versionsError } = await client
      .from("recipe_versions")
      .select("id,payload")
      .in("id", versionIds);

    if (versionsError) {
      throw new ApiError(
        500,
        "cookbook_version_fetch_failed",
        "Could not load cookbook versions",
        versionsError.message,
      );
    }

    versionById = new Map(
      (versions ?? []).map((v) => [v.id, v.payload as RecipePayload]),
    );
  }

  // Load variant statuses for recipes that have variants.
  const variantRecipeIds = [...entryMap.entries()]
    .filter(([, e]) => e.active_variant_id != null)
    .map(([recipeId]) => recipeId);

  const variantByRecipe = new Map<
    string,
    {
      stale_status: string;
      last_materialized_at: string | null;
      current_version_id: string | null;
      variant_tags: Record<string, unknown>;
    }
  >();

  if (variantRecipeIds.length > 0) {
    const { data: variants } = await client
      .from("user_recipe_variants")
      .select("canonical_recipe_id, stale_status, last_materialized_at, current_version_id, variant_tags")
      .eq("user_id", userId)
      .in("canonical_recipe_id", variantRecipeIds);

    for (const v of variants ?? []) {
      variantByRecipe.set(v.canonical_recipe_id, {
        stale_status: v.stale_status,
        last_materialized_at: v.last_materialized_at,
        current_version_id: v.current_version_id,
        variant_tags: (v.variant_tags as Record<string, unknown>) ?? {},
      });
    }
  }

  const variantVersionIds = Array.from(
    new Set(
      [...variantByRecipe.values()]
        .map((variant) => variant.current_version_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  let variantVersionById = new Map<string, RecipePayload>();
  if (variantVersionIds.length > 0) {
    const { data: variantVersions, error: variantVersionsError } = await client
      .from("user_recipe_variant_versions")
      .select("id,payload")
      .in("id", variantVersionIds);

    if (variantVersionsError) {
      throw new ApiError(
        500,
        "cookbook_variant_version_fetch_failed",
        "Could not load cookbook variant versions",
        variantVersionsError.message,
      );
    }

    variantVersionById = new Map(
      (variantVersions ?? []).map((version) => [
        version.id,
        version.payload as RecipePayload,
      ]),
    );
  }

  // Load categories (same as before).
  const [{ data: userCategories }, { data: autoCategories }] = await Promise
    .all([
      client
        .from("recipe_user_categories")
        .select("recipe_id,category")
        .eq("user_id", userId)
        .in("recipe_id", recipeIds),
      client
        .from("recipe_auto_categories")
        .select("recipe_id,category,confidence")
        .in("recipe_id", recipeIds)
        .order("confidence", { ascending: false, nullsFirst: false })
        .order("category", { ascending: true }),
    ]);

  const userCategoryByRecipe = new Map<string, string>();
  for (const entry of userCategories ?? []) {
    userCategoryByRecipe.set(entry.recipe_id, entry.category);
  }
  const autoCategoryByRecipe = buildHighestConfidenceCategoryMap(
    autoCategories ?? [],
  );

  const draftItems = recipes.map((recipe) => {
    const payload = recipe.current_version_id
      ? versionById.get(recipe.current_version_id)
      : undefined;
    const variant = variantByRecipe.get(recipe.id);
    const variantPayload = variant?.current_version_id
      ? variantVersionById.get(variant.current_version_id)
      : undefined;
    const userCategory = userCategoryByRecipe.get(recipe.id);
    const autoCategory = autoCategoryByRecipe.get(recipe.id);
    const canonicalMetadata = payload
      ? canonicalizeRecipePayloadMetadata(payload)
      : undefined;
    const entry = entryMap.get(recipe.id);

    const variantStatus: VariantStatus = variant
      ? (variant.stale_status as VariantStatus)
      : "none";

    const canonicalSemanticProfile = extractSemanticProfileFromPayload(payload);
    const variantSemanticProfile = extractSemanticProfileFromPayload(
      variantPayload,
    ) ?? normalizeRecipeSemanticProfile(
      (
        variant?.variant_tags as Record<string, JsonValue> | undefined
      )?.semantic_profile,
    );
    const effectiveSemanticProfile = mergeSemanticProfiles(
      canonicalSemanticProfile,
      variantSemanticProfile,
    );

    return {
      item_id: recipe.id,
      profile: effectiveSemanticProfile,
      canonical_recipe_id: recipe.id,
      title: payload?.title ?? recipe.title,
      summary: payload ? resolveRecipePayloadSummary(payload) : "",
      image_url: resolveRecipeImageUrl(recipe.hero_image_url),
      image_status: resolveRecipeImageStatus(
        recipe.hero_image_url,
        recipe.image_status,
      ),
      category: resolveCookbookPreviewCategory(userCategory, autoCategory),
      visibility: recipe.visibility,
      updated_at: recipe.updated_at,
      quick_stats: canonicalMetadata?.quick_stats ?? null,
      variant_status: variantStatus,
      active_variant_version_id: variant?.current_version_id ?? null,
      personalized_at: variant?.last_materialized_at ?? null,
      autopersonalize: entry?.autopersonalize ?? true,
      saved_at: entry?.saved_at ?? recipe.updated_at,
      variant_tags: flattenVariantTags(variant?.variant_tags),
      matched_chip_ids: [],
    };
  });

  const suggestedChips = buildSuggestedChips({
    items: draftItems.map((item) => ({
      item_id: item.item_id,
      profile: item.profile,
    })),
  });

  const items = draftItems.map(({ item_id: _itemId, profile, ...item }) => ({
    ...item,
    matched_chip_ids: buildMatchedChipIds({
      profile,
      chips: suggestedChips,
    }),
  }));

  return { items, suggestedChips };
};

export const buildCookbookFeed = async (
  client: SupabaseClient,
  userId: string,
): Promise<{ items: CookbookEntry[]; suggestedChips: SuggestedChip[] }> =>
  await buildCookbookData(client, userId);

export const buildCookbookItems = async (
  client: SupabaseClient,
  userId: string,
): Promise<CookbookEntry[]> => {
  const { items } = await buildCookbookData(client, userId);
  return items;
};

const normalizeCookbookInsight = (
  candidate: string | null | undefined,
): string | null => {
  if (typeof candidate !== "string") {
    return null;
  }

  const collapsed = candidate.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) {
    return null;
  }

  const sentenceBoundary = collapsed.search(/[.!?]\s/);
  const firstSentence = sentenceBoundary >= 0
    ? collapsed.slice(0, sentenceBoundary + 1)
    : collapsed;
  if (firstSentence.length <= 150) {
    return firstSentence;
  }

  return `${firstSentence.slice(0, 147).trimEnd()}...`;
};

export const buildCookbookInsightDeterministic = (
  items: CookbookEntry[],
): string | null => {
  if (items.length === 0) {
    return null;
  }

  const categoryCounts = new Map<string, number>();
  for (const item of items) {
    const category = typeof item.category === "string" &&
        item.category.trim().length > 0
      ? item.category.trim()
      : "favorites";
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
  }

  const topCategory = [...categoryCounts.entries()]
    .sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!topCategory) {
    return normalizeCookbookInsight(
      `You've saved ${items.length} recipes so far.`,
    );
  }

  if (items.length == 1) {
    return normalizeCookbookInsight(
      `Great start. Your first recipe is in ${topCategory}.`,
    );
  }

  return normalizeCookbookInsight(
    `You've built ${items.length} recipes with a strong ${topCategory} streak.`,
  );
};

const converseChatWithRetry = async (params: {
  client: SupabaseClient;
  userId: string;
  requestId: string;
  prompt: string;
  context: Record<string, JsonValue>;
  scopeHint?: "chat_ideation" | "chat_generation" | "chat_iteration";
  modelOverrides?: ModelOverrideMap;
}): Promise<Awaited<ReturnType<typeof llmGateway.converseChat>>> => {
  const callGateway = () =>
    llmGateway.converseChat({
      client: params.client,
      userId: params.userId,
      requestId: params.requestId,
      prompt: params.prompt,
      context: params.context,
      scopeHint: params.scopeHint,
      modelOverrides: params.modelOverrides,
    });

  try {
    return await callGateway();
  } catch (firstError) {
    const isRetryable =
      firstError instanceof ApiError &&
      (firstError.status === 422 ||
        firstError.code === "chat_schema_invalid" ||
        firstError.code === "llm_invalid_json" ||
        firstError.code === "llm_json_truncated" ||
        firstError.code === "llm_empty_output");
    if (!isRetryable) {
      throw firstError;
    }
    console.warn("converseChatWithRetry: retrying after schema error", {
      request_id: params.requestId,
      scope_hint: params.scopeHint,
      error_code: firstError instanceof ApiError ? firstError.code : "unknown",
    });
    return await callGateway();
  }
};

export type OrchestratedChatTurn = {
  assistantChatResponse: Awaited<ReturnType<typeof llmGateway.converseChat>>;
  nextCandidateSet: CandidateRecipeSet | null;
  nextLoopState: ChatLoopState;
  nextContext: ChatSessionContext;
  effectivePreferences: PreferenceContext;
  responseContext: ChatLoopResponse["response_context"] | null;
  justGenerated: boolean;
  /** True when ideation determined generation is needed but the heavy
   *  generation LLM call was skipped. The caller should return early
   *  with generation_pending so the client can show the Lottie and
   *  call POST /chat/:id/generate to run the actual generation. */
  generationDeferred: boolean;
};

export const orchestrateChatTurn = async (params: {
  client: SupabaseClient;
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  message: string;
  existingCandidate: CandidateRecipeSet | null;
  sessionContext: ChatSessionContext;
  contextPack: ContextPack;
  threadForPrompt: Array<{ role: string; content: string }>;
  modelOverrides?: ModelOverrideMap;
  /** When true, skip the heavy generation LLM call if ideation
   *  determines a recipe is needed. Lets the server return the
   *  ideation reply fast so the client can show the generation
   *  animation during the actual generation (separate request). */
  deferGeneration?: boolean;
  /** Force a specific scope, bypassing the automatic scope selection.
   *  Used by the /generate endpoint to skip re-running ideation and
   *  go straight to the generation LLM call. */
  scopeOverride?: "chat_ideation" | "chat_generation" | "chat_iteration";
}): Promise<OrchestratedChatTurn> => {
  const candidateOutlineForPrompt = buildCandidateOutlineForPrompt(
    params.existingCandidate,
  );
  const compactChatContext = buildCompactChatContext(params.sessionContext);
  const currentPendingConflict = normalizePendingPreferenceConflict(
    params.sessionContext.pending_preference_conflict,
  );
  const currentThreadOverrides = normalizeThreadPreferenceOverrides(
    params.sessionContext.thread_preference_overrides,
  );
  const effectivePromptPreferences = applyThreadPreferenceOverrides(
    params.contextPack.preferences,
    currentThreadOverrides,
  );
  const promptPreferencesNaturalLanguage = buildNaturalLanguagePreferenceContext(
    effectivePromptPreferences,
  );
  const isPreferenceEditingWorkflow = params.sessionContext.workflow ===
    "preferences";
  const scopeHint = params.scopeOverride ?? (isPreferenceEditingWorkflow
    ? "chat_ideation"
    : params.existingCandidate
    ? "chat_iteration"
    : currentPendingConflict
    ? "chat_generation"
    : "chat_ideation");
  const activeComponent =
    params.existingCandidate?.components.find((component) =>
      component.component_id === params.existingCandidate?.active_component_id
    ) ??
      params.existingCandidate?.components[0] ??
      null;

  // When the user is editing preferences from the Preferences screen,
  // inject a strong behavioral instruction so the LLM stays in preference
  // discovery mode and never tries to generate a recipe. The intent tells
  // the model exactly which preference category the user is editing.
  const preferenceWorkflowInstruction = isPreferenceEditingWorkflow
    ? buildPreferenceWorkflowInstruction(params.sessionContext)
    : null;

  let assistantChatResponse = await converseChatWithRetry({
    client: params.serviceClient,
    userId: params.userId,
    requestId: params.requestId,
    prompt: params.message,
    context: {
      chat_context: compactChatContext,
      thread: params.threadForPrompt,
      active_recipe: activeComponent?.recipe
        ? (activeComponent.recipe as unknown as JsonValue)
        : null,
      candidate_recipe_set: params.existingCandidate
        ? (params.existingCandidate as unknown as JsonValue)
        : null,
      candidate_recipe_set_outline: candidateOutlineForPrompt,
      loop_state: deriveLoopState(
        params.sessionContext,
        params.existingCandidate,
      ),
      preferences: effectivePromptPreferences,
      preferences_natural_language: promptPreferencesNaturalLanguage,
      selected_memories: params.contextPack.selectedMemories,
      ...(preferenceWorkflowInstruction
        ? { preference_workflow_instruction: preferenceWorkflowInstruction }
        : {}),
    },
    scopeHint,
    modelOverrides: params.modelOverrides,
  });

  // Hard guard: if this is a preference-editing workflow, strip any recipe
  // generation output the LLM may have produced despite instructions. The
  // preference chat must never produce recipes or candidate sets.
  if (isPreferenceEditingWorkflow) {
    assistantChatResponse = {
      ...assistantChatResponse,
      trigger_recipe: false,
      recipe: undefined,
      candidate_recipe_set: undefined,
      response_context: {
        ...(assistantChatResponse.response_context ?? {}),
        mode: "ideation",
        intent: "in_scope_ideation",
      },
    };
  }

  const intent = getChatIntentFromResponse(assistantChatResponse);
  const isOutOfScope = intent === "out_of_scope";
  const isPreferenceConflict = assistantChatResponse.response_context?.mode ===
      "preference_conflict" ||
    assistantChatResponse.response_context?.preference_conflict?.status ===
      "pending_confirmation";
  const explicitGenerationIntent = intent === "in_scope_generate" ||
    assistantChatResponse.trigger_recipe === true ||
    assistantChatResponse.response_context?.mode === "generation";

  // Track whether generation was deferred so the caller can return
  // a fast response with generation_pending and let the client call
  // POST /chat/:id/generate separately.
  let generationDeferred = false;

  if (
    !isPreferenceEditingWorkflow &&
    scopeHint === "chat_ideation" && !params.existingCandidate &&
    !isOutOfScope && !isPreferenceConflict && explicitGenerationIntent
  ) {
    if (
      !assistantChatResponse.candidate_recipe_set &&
      !assistantChatResponse.recipe
    ) {
      if (params.deferGeneration) {
        // Skip the heavy generation LLM call. Return the ideation
        // reply immediately so the client can show the generation
        // animation while the actual generation happens via a
        // separate POST /chat/:id/generate request.
        generationDeferred = true;
      } else {
        try {
          const generationResponse = await converseChatWithRetry({
            client: params.serviceClient,
            userId: params.userId,
            requestId: params.requestId,
            prompt: params.message,
            context: {
              chat_context: compactChatContext,
              thread: params.threadForPrompt,
              active_recipe: null,
              candidate_recipe_set: null,
              candidate_recipe_set_outline: null,
              loop_state: "generation",
              preferences: effectivePromptPreferences,
              preferences_natural_language: promptPreferencesNaturalLanguage,
              selected_memories: params.contextPack.selectedMemories,
            },
            scopeHint: "chat_generation",
            modelOverrides: params.modelOverrides,
          });
          assistantChatResponse = {
            ...generationResponse,
            response_context: {
              ...(generationResponse.response_context ?? {}),
              mode: generationResponse.response_context?.mode ?? "generation",
              intent:
                normalizeChatIntent(generationResponse.response_context?.intent) ??
                  "in_scope_generate",
            },
          };
        } catch (error) {
          console.error("chat_generation_conversion_failed", {
            request_id: params.requestId,
            error: error instanceof Error ? error.message : String(error),
          });
          assistantChatResponse = {
            ...assistantChatResponse,
            trigger_recipe: true,
            response_context: {
              ...(assistantChatResponse.response_context ?? {}),
              mode: "generation",
              intent:
                normalizeChatIntent(
                  assistantChatResponse.response_context?.intent,
                ) ?? "in_scope_generate",
            },
          };
        }
      }
    }

  }

  if (isOutOfScope) {
    assistantChatResponse = {
      ...assistantChatResponse,
      trigger_recipe: false,
      recipe: undefined,
      candidate_recipe_set: undefined,
      response_context: {
        ...(assistantChatResponse.response_context ?? {}),
        mode: "ideation",
        intent: "out_of_scope",
      },
      assistant_reply: assistantChatResponse.assistant_reply,
    };
  }

  const effectivePreferences = await applyModelPreferenceUpdates({
    client: params.client,
    serviceClient: params.serviceClient,
    userId: params.userId,
    requestId: params.requestId,
    currentPreferences: params.contextPack.preferences,
    preferenceUpdates: assistantChatResponse.response_context
      ?.preference_updates,
    latestUserMessage: params.message,
  });

  const modelCandidateSet = normalizeCandidateRecipeSet(
    assistantChatResponse.candidate_recipe_set ?? null,
  );
  const generatedCandidateFromModel = Boolean(
    modelCandidateSet || assistantChatResponse.recipe,
  );
  let nextCandidateSet: CandidateRecipeSet | null = modelCandidateSet;
  if (!nextCandidateSet && assistantChatResponse.recipe && !isOutOfScope) {
    nextCandidateSet = mergeRecipeIntoCandidate(
      params.existingCandidate,
      assistantChatResponse.recipe,
    );
  }
  if (!nextCandidateSet && params.existingCandidate) {
    nextCandidateSet = params.existingCandidate;
  }

  if (params.existingCandidate && nextCandidateSet) {
    nextCandidateSet = {
      ...nextCandidateSet,
      candidate_id: params.existingCandidate.candidate_id,
      revision: Math.max(
        params.existingCandidate.revision + 1,
        nextCandidateSet.revision,
      ),
      active_component_id: nextCandidateSet.active_component_id &&
          nextCandidateSet.components.some((component) =>
            component.component_id === nextCandidateSet?.active_component_id
          )
        ? nextCandidateSet.active_component_id
        : nextCandidateSet.components[0]?.component_id ??
          params.existingCandidate.active_component_id,
    };
  }

  const nextLoopState: ChatLoopState = nextCandidateSet
    ? "candidate_presented"
    : "ideation";
  const responsePreferenceConflict =
    assistantChatResponse.response_context?.preference_conflict;
  let nextPendingPreferenceConflict = derivePendingPreferenceConflictFromResponse(
    responsePreferenceConflict,
  );
  if (!nextPendingPreferenceConflict && isPreferenceConflict) {
    nextPendingPreferenceConflict = currentPendingConflict;
  }
  if (
    responsePreferenceConflict?.status === "adapt" ||
    responsePreferenceConflict?.status === "override" ||
    responsePreferenceConflict?.status === "cleared" ||
    generatedCandidateFromModel
  ) {
    nextPendingPreferenceConflict = null;
  }
  const nextThreadOverrides = mergeThreadPreferenceOverrides({
    current: currentThreadOverrides,
    pendingConflict: currentPendingConflict,
    preferenceConflict: responsePreferenceConflict,
  });
  const responseContext = assistantChatResponse.response_context
    ? {
      mode: assistantChatResponse.response_context.mode,
      intent:
        normalizeChatIntent(assistantChatResponse.response_context.intent) ??
          undefined,
      changed_sections: assistantChatResponse.response_context.changed_sections,
      personalization_notes: assistantChatResponse.response_context
        .personalization_notes,
      preference_updates: assistantChatResponse.response_context
        .preference_updates,
      preference_conflict: responsePreferenceConflict,
    }
    : null;

  const nextContext: ChatSessionContext = {
    preferences: effectivePreferences,
    memory_snapshot: params.contextPack.memorySnapshot,
    selected_memory_ids: params.contextPack.selectedMemoryIds,
    loop_state: nextLoopState,
    candidate_recipe_set: nextCandidateSet,
    candidate_revision: nextCandidateSet?.revision ?? 0,
    active_component_id: nextCandidateSet?.active_component_id ?? null,
    pending_preference_conflict: nextPendingPreferenceConflict,
    thread_preference_overrides: nextThreadOverrides,
    // Persist the pending flag so the /generate endpoint can pick it up.
    generation_pending: generationDeferred ? true : undefined,
    // Preserve session-level fields set at creation time. Without this,
    // updateChatSessionLoopContext overwrites the full context JSONB and
    // drops workflow/entry_surface/preference_editing_intent, breaking
    // the preference-editing chat flow on every turn after the first.
    workflow: params.sessionContext.workflow,
    entry_surface: params.sessionContext.entry_surface,
    preference_editing_intent: params.sessionContext.preference_editing_intent,
  };

  return {
    assistantChatResponse,
    nextCandidateSet,
    nextLoopState,
    nextContext,
    effectivePreferences,
    responseContext,
    justGenerated: !params.existingCandidate && Boolean(nextCandidateSet),
    generationDeferred,
  };
};
