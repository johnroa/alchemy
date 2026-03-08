import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { llmGateway } from "../../../_shared/llm-gateway.ts";
import type { JsonValue } from "../../../_shared/types.ts";
import type { DemandObservationExtraction } from "../../../_shared/llm-gateway/types.ts";
import {
  asTrimmedString,
  clampConfidence,
  isDemandFacet,
  isDemandOutcomeType,
  normalizeDemandSnippet,
  normalizeDemandValue,
  toIsoString,
  toRecord,
  type DemandFactRecord,
  type DemandObservationRecord,
  type DemandOutcomeRecord,
  type DemandStage,
} from "./types.ts";

export type DemandJobRow = {
  id: string;
  source_kind: string;
  source_id: string;
  user_id: string | null;
  stage: DemandStage;
  extractor_scope: string;
  extractor_version: number;
  observed_at: string;
  payload_jsonb: Record<string, JsonValue> | null;
};

type DemandExtractionResult = {
  observation: DemandObservationRecord;
  facts: DemandFactRecord[];
  outcomes: DemandOutcomeRecord[];
};

const LINKABLE_FACETS = new Set([
  "dish",
  "cuisine",
  "ingredient_want",
  "ingredient_avoid",
  "pantry_item",
  "occasion",
  "appliance",
  "requested_substitution",
]);

const toRedactedSnippet = (...candidates: Array<string | null | undefined>): string | null => {
  for (const candidate of candidates) {
    const snippet = normalizeDemandSnippet(candidate);
    if (snippet) {
      return snippet;
    }
  }
  return null;
};

const buildObservationRecord = (params: {
  job: DemandJobRow;
  stage: DemandStage;
  extractorScope: string;
  userId: string | null;
  observedAt?: string | null;
  chatSessionId?: string | null;
  recipeId?: string | null;
  variantId?: string | null;
  confidence?: number;
  privacyTier?: "derived" | "redacted_snippet";
  adminSnippetRedacted?: string | null;
  rawTraceRef?: string | null;
  summary?: Record<string, JsonValue>;
}): DemandObservationRecord => {
  const sourceKey = [
    params.job.source_kind,
    params.job.source_id,
    params.stage,
    String(params.job.extractor_version),
  ].join(":");

  const confidence = clampConfidence(params.confidence, 0.5);
  return {
    sourceKind: params.job.source_kind,
    sourceId: params.job.source_id,
    userId: params.userId,
    chatSessionId: params.chatSessionId ?? null,
    recipeId: params.recipeId ?? null,
    variantId: params.variantId ?? null,
    observedAt: toIsoString(params.observedAt, params.job.observed_at),
    stage: params.stage,
    extractorScope: params.extractorScope,
    extractorVersion: params.job.extractor_version,
    confidence,
    privacyTier: params.privacyTier ?? "derived",
    adminSnippetRedacted: params.adminSnippetRedacted ?? null,
    rawTraceRef: params.rawTraceRef ?? null,
    summary: params.summary ?? {},
    sampledForReview: false,
    sampledAt: null,
  };
};

const normalizeExtractedFacts = (
  extraction: DemandObservationExtraction,
): DemandFactRecord[] => {
  const facts = Array.isArray(extraction.facts) ? extraction.facts : [];

  const normalizedFacts: Array<DemandFactRecord | null> = facts
    .map((fact, index) => {
      const facet = asTrimmedString(fact.facet);
      const normalizedValue = asTrimmedString(fact.normalized_value);
      if (!facet || !normalizedValue || !isDemandFacet(facet)) {
        return null;
      }

      return {
        facet,
        normalizedValue: normalizeDemandValue(normalizedValue),
        rawValue: asTrimmedString(fact.raw_value),
        polarity:
          fact.polarity === "negative" || fact.polarity === "neutral" || fact.polarity === "positive"
            ? fact.polarity
            : "positive",
        confidence: clampConfidence(fact.confidence, 0.5),
        rank: Number.isFinite(Number(fact.rank)) ? Math.max(1, Math.trunc(Number(fact.rank))) : index + 1,
        entityId: null,
        metadata: toRecord(fact.metadata),
      } satisfies DemandFactRecord;
    });

  return normalizedFacts.filter((fact): fact is DemandFactRecord => fact !== null).slice(0, 24);
};

const applyLinkedEntities = async (params: {
  serviceClient: SupabaseClient;
  userId: string | null;
  requestId: string;
  facts: DemandFactRecord[];
}): Promise<DemandFactRecord[]> => {
  if (!params.userId || params.facts.length === 0) {
    return params.facts;
  }

  const candidateEntities: Array<{
    fact_index: number;
    entity_id: string;
    entity_type: string;
    label: string;
    entity_key: string | null;
  }> = [];

  for (let factIndex = 0; factIndex < params.facts.length; factIndex += 1) {
    const fact = params.facts[factIndex];
    if (!LINKABLE_FACETS.has(fact.facet)) {
      continue;
    }

    const lookupValue = fact.rawValue ?? fact.normalizedValue.replace(/_/g, " ");
    if (lookupValue.length < 3) {
      continue;
    }

    const { data } = await params.serviceClient
      .from("graph_entities")
      .select("id,entity_type,label,entity_key")
      .ilike("label", `%${lookupValue}%`)
      .limit(6);

    for (const entity of data ?? []) {
      candidateEntities.push({
        fact_index: factIndex,
        entity_id: String(entity.id),
        entity_type: String(entity.entity_type),
        label: String(entity.label),
        entity_key: entity.entity_key ? String(entity.entity_key) : null,
      });
    }
  }

  if (candidateEntities.length === 0) {
    return params.facts;
  }

  const linked = await llmGateway.linkDemandEntities({
    client: params.serviceClient,
    userId: params.userId,
    requestId: params.requestId,
    facts: params.facts.map((fact) => ({
      facet: fact.facet,
      normalized_value: fact.normalizedValue,
      raw_value: fact.rawValue,
      polarity: fact.polarity,
      confidence: fact.confidence,
      rank: fact.rank,
      metadata: fact.metadata,
    })),
    candidateEntities,
  });

  const nextFacts = [...params.facts];
  for (const selection of linked) {
    const current = nextFacts[selection.fact_index];
    if (!current) {
      continue;
    }
    current.entityId = selection.entity_id;
    current.confidence = Math.max(current.confidence, clampConfidence(selection.confidence, current.confidence));
  }
  return nextFacts;
};

const findLatestOriginObservation = async (params: {
  serviceClient: SupabaseClient;
  userId: string | null;
  chatSessionId?: string | null;
  recipeId?: string | null;
  sourceSessionId?: string | null;
}): Promise<string | null> => {
  if (!params.userId) {
    return null;
  }

  const chatSessionId = params.chatSessionId ?? params.sourceSessionId ?? null;
  if (chatSessionId) {
    const { data } = await params.serviceClient
      .from("demand_observations")
      .select("id")
      .eq("user_id", params.userId)
      .eq("chat_session_id", chatSessionId)
      .in("stage", ["intent", "iteration", "import"])
      .order("observed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.id) {
      return String(data.id);
    }
  }

  if (params.recipeId) {
    const { data } = await params.serviceClient
      .from("demand_observations")
      .select("id")
      .eq("user_id", params.userId)
      .eq("recipe_id", params.recipeId)
      .order("observed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.id) {
      return String(data.id);
    }
  }

  return null;
};

const extractFromChatMessage = async (params: {
  serviceClient: SupabaseClient;
  job: DemandJobRow;
  requestId: string;
}): Promise<DemandExtractionResult> => {
  const { data: message } = await params.serviceClient
    .from("chat_messages")
    .select("id,chat_id,content,created_at")
    .eq("id", params.job.source_id)
    .maybeSingle();

  if (!message) {
    throw new Error("chat_message_missing");
  }

  const payload = toRecord(params.job.payload_jsonb);
  const assistantResponseContext = toRecord(payload.response_context);
  const extraction = params.job.stage === "iteration"
    ? await llmGateway.extractDemandIterationDelta({
      client: params.serviceClient,
      userId: params.job.user_id ?? "system-demand",
      requestId: params.requestId,
      stage: params.job.stage,
      sourceContext: {
        user_message: message.content as JsonValue,
        response_context: assistantResponseContext,
        candidate_id: payload.candidate_id ?? null,
        active_component_id: payload.active_component_id ?? null,
        workflow: payload.workflow ?? null,
        entry_surface: payload.entry_surface ?? null,
      },
    })
    : await llmGateway.extractDemandObservation({
      client: params.serviceClient,
      userId: params.job.user_id ?? "system-demand",
      requestId: params.requestId,
      stage: params.job.stage,
      sourceContext: {
        user_message: message.content as JsonValue,
        response_context: assistantResponseContext,
        candidate_id: payload.candidate_id ?? null,
        workflow: payload.workflow ?? null,
        entry_surface: payload.entry_surface ?? null,
      },
    });

  const facts = await applyLinkedEntities({
    serviceClient: params.serviceClient,
    userId: params.job.user_id,
    requestId: params.requestId,
    facts: normalizeExtractedFacts(extraction),
  });

  return {
    observation: buildObservationRecord({
      job: params.job,
      stage: params.job.stage,
      extractorScope: params.job.extractor_scope,
      userId: params.job.user_id,
      chatSessionId: String(message.chat_id),
      observedAt: message.created_at,
      confidence:
        facts.length > 0
          ? facts.reduce((sum, fact) => sum + fact.confidence, 0) / facts.length
          : 0.55,
      privacyTier: extraction.privacy_tier === "redacted_snippet" ? "redacted_snippet" : "derived",
      adminSnippetRedacted: toRedactedSnippet(
        extraction.admin_snippet_redacted,
        message.content,
      ),
      rawTraceRef: `chat_messages/${message.id}`,
      summary: {
        summary: extraction.summary ?? assistantResponseContext.intent ?? null,
        why_now: extraction.why_now ?? null,
        response_context: assistantResponseContext,
      },
    }),
    facts,
    outcomes: [],
  };
};

const extractFromImport = async (params: {
  serviceClient: SupabaseClient;
  job: DemandJobRow;
  requestId: string;
}): Promise<DemandExtractionResult> => {
  const { data: provenance } = await params.serviceClient
    .from("import_provenance")
    .select("id,chat_session_id,source_kind,source_url,extraction_strategy,extraction_confidence,metadata,updated_at")
    .eq("id", params.job.source_id)
    .maybeSingle();

  if (!provenance) {
    throw new Error("import_provenance_missing");
  }

  const metadata = toRecord(provenance.metadata);
  const extraction = await llmGateway.extractDemandObservation({
    client: params.serviceClient,
    userId: params.job.user_id ?? "system-demand",
    requestId: params.requestId,
    stage: "import",
    sourceContext: {
      import_source_kind: String(provenance.source_kind) as JsonValue,
      source_url: provenance.source_url ? String(provenance.source_url) as JsonValue : null,
      extraction_strategy: provenance.extraction_strategy ? String(provenance.extraction_strategy) as JsonValue : null,
      extraction_confidence: Number(provenance.extraction_confidence ?? 0) as JsonValue,
      recipe_title: metadata.recipe_title ?? null,
      source_site_name: metadata.source_site_name ?? null,
      response_context: payloadResponseContext(params.job.payload_jsonb),
    },
  });

  const facts = await applyLinkedEntities({
    serviceClient: params.serviceClient,
    userId: params.job.user_id,
    requestId: params.requestId,
    facts: normalizeExtractedFacts(extraction),
  });

  return {
    observation: buildObservationRecord({
      job: params.job,
      stage: "import",
      extractorScope: params.job.extractor_scope,
      userId: params.job.user_id,
      chatSessionId: provenance.chat_session_id ? String(provenance.chat_session_id) : null,
      observedAt: provenance.updated_at,
      confidence:
        facts.length > 0
          ? facts.reduce((sum, fact) => sum + fact.confidence, 0) / facts.length
          : clampConfidence(provenance.extraction_confidence, 0.6),
      privacyTier: extraction.privacy_tier === "redacted_snippet" ? "redacted_snippet" : "derived",
      adminSnippetRedacted: toRedactedSnippet(
        extraction.admin_snippet_redacted,
        asTrimmedString(metadata.recipe_title),
      ),
      rawTraceRef: `import_provenance/${provenance.id}`,
      summary: {
        summary: extraction.summary ?? metadata.recipe_title ?? null,
        why_now: extraction.why_now ?? null,
        extraction_strategy: provenance.extraction_strategy ? String(provenance.extraction_strategy) : null,
        source_kind: provenance.source_kind ? String(provenance.source_kind) : null,
      },
    }),
    facts,
    outcomes: [],
  };
};

const extractOnboardingCompletion = async (params: {
  serviceClient: SupabaseClient;
  job: DemandJobRow;
  requestId: string;
}): Promise<DemandExtractionResult> => {
  const payload = toRecord(params.job.payload_jsonb);
  const extraction = await llmGateway.extractDemandObservation({
    client: params.serviceClient,
    userId: params.job.user_id ?? "system-demand",
    requestId: params.requestId,
    stage: "intent",
    sourceContext: {
      workflow: "onboarding",
      latest_message: payload.latest_message ?? null,
      onboarding_state: payload.onboarding_state ?? {},
      preference_updates: payload.preference_updates ?? {},
      effective_preferences: payload.effective_preferences ?? {},
    },
  });

  const facts = await applyLinkedEntities({
    serviceClient: params.serviceClient,
    userId: params.job.user_id,
    requestId: params.requestId,
    facts: normalizeExtractedFacts(extraction),
  });

  return {
    observation: buildObservationRecord({
      job: params.job,
      stage: "intent",
      extractorScope: params.job.extractor_scope,
      userId: params.job.user_id,
      observedAt: params.job.observed_at,
      confidence:
        facts.length > 0
          ? facts.reduce((sum, fact) => sum + fact.confidence, 0) / facts.length
          : 0.62,
      privacyTier: extraction.privacy_tier === "redacted_snippet" ? "redacted_snippet" : "derived",
      adminSnippetRedacted: toRedactedSnippet(
        extraction.admin_snippet_redacted,
        asTrimmedString(payload.latest_message),
      ),
      rawTraceRef: `onboarding_completion/${params.job.source_id}`,
      summary: {
        summary: extraction.summary ?? "Onboarding completion",
        why_now: extraction.why_now ?? null,
        onboarding_state: payload.onboarding_state ?? {},
      },
    }),
    facts,
    outcomes: [],
  };
};

const extractCandidateAction = async (params: {
  serviceClient: SupabaseClient;
  job: DemandJobRow;
}): Promise<DemandExtractionResult> => {
  const payload = toRecord(params.job.payload_jsonb);
  const action = asTrimmedString(payload.action) ?? "set_active_component";
  const chatId = asTrimmedString(payload.chat_id);
  const candidateId = asTrimmedString(payload.candidate_id);
  const components = Array.isArray(payload.components)
    ? payload.components.filter((item) => item && typeof item === "object")
    : [];

  const observation = buildObservationRecord({
    job: params.job,
    stage: "selection",
    extractorScope: "deterministic_selection_v1",
    userId: params.job.user_id,
    chatSessionId: chatId,
    observedAt: params.job.observed_at,
    confidence: 0.98,
    privacyTier: "derived",
    adminSnippetRedacted: toRedactedSnippet(asTrimmedString(payload.component_title)),
    rawTraceRef: chatId ? `chat_sessions/${chatId}` : `chat_candidate_action/${params.job.source_id}`,
    summary: {
      action,
      component_id: payload.component_id ?? null,
      component_title: payload.component_title ?? null,
      candidate_id: candidateId ?? null,
    },
  });

  const outcomes: DemandOutcomeRecord[] = [];
  if (action === "set_active_component") {
    outcomes.push({
      observationId: "",
      originObservationId: null,
      outcomeType: "candidate_selected",
      sourceKind: params.job.source_kind,
      sourceId: `${params.job.source_id}:selected`,
      recipeId: null,
      variantId: null,
      candidateId,
      occurredAt: params.job.observed_at,
      payload: {
        component_id: payload.component_id ?? null,
        component_title: payload.component_title ?? null,
        role: payload.component_role ?? null,
      },
    });
  } else {
    const rejectedComponents = components.length > 0
      ? components
      : [{
        component_id: payload.component_id ?? null,
        title: payload.component_title ?? null,
        role: payload.component_role ?? null,
      }];

    rejectedComponents.forEach((component, index) => {
      const value = toRecord(component);
      outcomes.push({
        observationId: "",
        originObservationId: null,
        outcomeType: "candidate_rejected",
        sourceKind: params.job.source_kind,
        sourceId: `${params.job.source_id}:rejected:${index}`,
        recipeId: null,
        variantId: null,
        candidateId,
        occurredAt: params.job.observed_at,
        payload: {
          action,
          component_id: value.component_id ?? null,
          component_title: value.title ?? null,
          role: value.role ?? null,
        },
      });
    });
  }

  return { observation, facts: [], outcomes };
};

const extractCommit = async (params: {
  serviceClient: SupabaseClient;
  job: DemandJobRow;
}): Promise<DemandExtractionResult> => {
  const payload = toRecord(params.job.payload_jsonb);
  const chatId = asTrimmedString(payload.chat_id);
  const candidateId = asTrimmedString(payload.candidate_id);
  const recipes = Array.isArray(payload.recipes)
    ? payload.recipes.filter((item) => item && typeof item === "object")
    : [];

  const observation = buildObservationRecord({
    job: params.job,
    stage: "commit",
    extractorScope: "deterministic_commit_v1",
    userId: params.job.user_id,
    chatSessionId: chatId,
    recipeId: recipes.length > 0
      ? asTrimmedString(toRecord(recipes[0]).recipe_id)
      : null,
    observedAt: params.job.observed_at,
    confidence: 0.99,
    privacyTier: "derived",
    adminSnippetRedacted: toRedactedSnippet(asTrimmedString(toRecord(recipes[0] ?? null).title)),
    rawTraceRef: chatId ? `chat_sessions/${chatId}` : `chat_commit/${params.job.source_id}`,
    summary: {
      candidate_id: candidateId ?? null,
      committed_count: recipes.length,
      recipes: recipes as unknown as JsonValue,
    },
  });

  const outcomes = recipes.map((recipe, index) => {
    const value = toRecord(recipe);
    return {
      observationId: "",
      originObservationId: null,
      outcomeType: "recipe_committed" as const,
      sourceKind: params.job.source_kind,
      sourceId: `${params.job.source_id}:recipe:${index}`,
      recipeId: asTrimmedString(value.recipe_id),
      variantId: asTrimmedString(value.variant_id),
      candidateId,
      occurredAt: params.job.observed_at,
      payload: {
        title: value.title ?? null,
        role: value.role ?? null,
        recipe_version_id: value.recipe_version_id ?? null,
      },
    };
  });

  return { observation, facts: [], outcomes };
};

const extractRecipeSave = async (params: {
  serviceClient: SupabaseClient;
  job: DemandJobRow;
}): Promise<DemandExtractionResult> => {
  const payload = toRecord(params.job.payload_jsonb);
  const recipeId = asTrimmedString(payload.recipe_id);
  const sourceSessionId = asTrimmedString(payload.source_session_id);
  const observation = buildObservationRecord({
    job: params.job,
    stage: "feedback",
    extractorScope: "deterministic_recipe_save_v1",
    userId: params.job.user_id,
    chatSessionId: sourceSessionId,
    recipeId,
    observedAt: params.job.observed_at,
    confidence: 0.96,
    privacyTier: "derived",
    adminSnippetRedacted: toRedactedSnippet(asTrimmedString(payload.recipe_title)),
    rawTraceRef: recipeId ? `recipes/${recipeId}` : `recipe_save/${params.job.source_id}`,
    summary: {
      source_surface: payload.source_surface ?? null,
      autopersonalize: payload.autopersonalize ?? null,
      recipe_id: recipeId ?? null,
    },
  });

  return {
    observation,
    facts: [],
    outcomes: [{
      observationId: "",
      originObservationId: null,
      outcomeType: "recipe_saved",
      sourceKind: params.job.source_kind,
      sourceId: `${params.job.source_id}:saved`,
      recipeId,
      variantId: null,
      candidateId: null,
      occurredAt: params.job.observed_at,
      payload,
    }],
  };
};

const extractVariantRefresh = async (params: {
  serviceClient: SupabaseClient;
  job: DemandJobRow;
  requestId: string;
}): Promise<DemandExtractionResult> => {
  const payload = toRecord(params.job.payload_jsonb);
  const manualInstructions = asTrimmedString(payload.manual_edit_instructions);
  const provenance = toRecord(payload.provenance);
  const baseSummary = {
    adaptation_summary: provenance.adaptation_summary ?? payload.adaptation_summary ?? null,
    substitution_diffs: provenance.substitution_diffs ?? payload.substitution_diffs ?? [],
    conflicts: provenance.conflicts ?? payload.conflicts ?? [],
  };

  const extraction = manualInstructions
    ? await llmGateway.extractDemandIterationDelta({
      client: params.serviceClient,
      userId: params.job.user_id ?? "system-demand",
      requestId: params.requestId,
      stage: "iteration",
      sourceContext: {
        manual_edit_instructions: manualInstructions as JsonValue,
        variant_summary: baseSummary as unknown as JsonValue,
      },
    })
    : null;
  const outcomeSummary = await llmGateway.summarizeDemandOutcomeReason({
    client: params.serviceClient,
    userId: params.job.user_id ?? "system-demand",
    requestId: params.requestId,
    outcomeType: "variant_refreshed",
    sourceContext: {
      manual_edit_instructions: manualInstructions as JsonValue,
      variant_summary: baseSummary as unknown as JsonValue,
    },
  });

  const facts = extraction
    ? await applyLinkedEntities({
      serviceClient: params.serviceClient,
      userId: params.job.user_id,
      requestId: params.requestId,
      facts: normalizeExtractedFacts(extraction),
    })
    : [];

  const observation = buildObservationRecord({
    job: params.job,
    stage: manualInstructions ? "iteration" : "feedback",
    extractorScope: manualInstructions ? "demand_extract_iteration_delta" : "demand_summarize_outcome_reason",
    userId: params.job.user_id,
    recipeId: asTrimmedString(payload.recipe_id),
    variantId: asTrimmedString(payload.variant_id),
    observedAt: params.job.observed_at,
    confidence:
      facts.length > 0
        ? facts.reduce((sum, fact) => sum + fact.confidence, 0) / facts.length
        : 0.82,
    privacyTier: extraction?.privacy_tier === "redacted_snippet" ? "redacted_snippet" : "derived",
    adminSnippetRedacted: toRedactedSnippet(
      extraction?.admin_snippet_redacted ?? outcomeSummary.admin_snippet_redacted,
      manualInstructions,
    ),
    rawTraceRef: payload.variant_version_id
      ? `user_recipe_variant_versions/${payload.variant_version_id}`
      : `variant_refresh/${params.job.source_id}`,
    summary: {
      summary: extraction?.summary ?? outcomeSummary.summary ?? provenance.adaptation_summary ?? null,
      why_now: extraction?.why_now ?? null,
      ...baseSummary,
    },
  });

  return {
    observation,
    facts,
    outcomes: [{
      observationId: "",
      originObservationId: null,
      outcomeType: "variant_refreshed",
      sourceKind: params.job.source_kind,
      sourceId: `${params.job.source_id}:variant_refreshed`,
      recipeId: asTrimmedString(payload.recipe_id),
      variantId: asTrimmedString(payload.variant_id),
      candidateId: null,
      occurredAt: params.job.observed_at,
      payload,
    }],
  };
};

const extractBehaviorEvent = async (params: {
  serviceClient: SupabaseClient;
  job: DemandJobRow;
}): Promise<DemandExtractionResult> => {
  const { data: event } = await params.serviceClient
    .from("behavior_events")
    .select("event_id,user_id,event_type,occurred_at,entity_type,entity_id,session_id,payload")
    .eq("event_id", params.job.source_id)
    .maybeSingle();

  if (!event) {
    throw new Error("behavior_event_missing");
  }

  const payload = toRecord(event.payload);
  const sourceSessionId = asTrimmedString(payload.source_session_id) ?? asTrimmedString(event.session_id);
  const recipeId = event.entity_type === "recipe" ? asTrimmedString(event.entity_id) : null;

  if (event.event_type === "ingredient_substitution_applied") {
    const { data: variant } = recipeId && params.job.user_id
      ? await params.serviceClient
        .from("user_recipe_variants")
        .select("id,current_version_id")
        .eq("user_id", params.job.user_id)
        .eq("canonical_recipe_id", recipeId)
        .maybeSingle()
      : { data: null };

    const { data: version } = variant?.current_version_id
      ? await params.serviceClient
        .from("user_recipe_variant_versions")
        .select("provenance")
        .eq("id", variant.current_version_id)
        .maybeSingle()
      : { data: null };

    const provenance = toRecord(version?.provenance);
    const substitutionDiffs = Array.isArray(provenance.substitution_diffs)
      ? provenance.substitution_diffs.filter((item) => item && typeof item === "object")
      : [];

    return {
      observation: buildObservationRecord({
        job: params.job,
        stage: "feedback",
        extractorScope: "deterministic_substitution_feedback_v1",
        userId: params.job.user_id,
        chatSessionId: sourceSessionId,
        recipeId,
        variantId: variant?.id ? String(variant.id) : null,
        observedAt: event.occurred_at,
        confidence: 0.95,
        privacyTier: "derived",
        adminSnippetRedacted: toRedactedSnippet(asTrimmedString(provenance.adaptation_summary)),
        rawTraceRef: `behavior_events/${event.event_id}`,
        summary: {
          event_type: event.event_type,
          diff_count: payload.diff_count ?? substitutionDiffs.length,
          has_conflicts: payload.has_conflicts ?? null,
          adaptation_summary: provenance.adaptation_summary ?? null,
        },
      }),
      facts: [],
      outcomes: substitutionDiffs.map((diff, index) => {
        const value = toRecord(diff);
        return {
          observationId: "",
          originObservationId: null,
          outcomeType: "substitution_accepted",
          sourceKind: params.job.source_kind,
          sourceId: `${params.job.source_id}:substitution:${index}`,
          recipeId,
          variantId: variant?.id ? String(variant.id) : null,
          candidateId: null,
          occurredAt: event.occurred_at,
          payload: {
            original: value.original ?? null,
            replacement: value.replacement ?? null,
            constraint: value.constraint ?? null,
            reason: value.reason ?? null,
          },
        };
      }),
    };
  }

  if (event.event_type === "recipe_cooked_inferred") {
    return {
      observation: buildObservationRecord({
        job: params.job,
        stage: "consumption",
        extractorScope: "deterministic_recipe_consumption_v1",
        userId: params.job.user_id,
        chatSessionId: sourceSessionId,
        recipeId,
        observedAt: event.occurred_at,
        confidence: 0.93,
        privacyTier: "derived",
        adminSnippetRedacted: null,
        rawTraceRef: `behavior_events/${event.event_id}`,
        summary: {
          event_type: event.event_type,
          active_dwell_seconds: payload.active_dwell_seconds ?? null,
        },
      }),
      facts: [],
      outcomes: [{
        observationId: "",
        originObservationId: null,
        outcomeType: "cook_inferred",
        sourceKind: params.job.source_kind,
        sourceId: `${params.job.source_id}:cook`,
        recipeId,
        variantId: null,
        candidateId: null,
        occurredAt: event.occurred_at,
        payload,
      }],
    };
  }

  throw new Error(`unsupported_behavior_event:${event.event_type}`);
};

const payloadResponseContext = (value: unknown): Record<string, JsonValue> => {
  const payload = toRecord(value);
  return toRecord(payload.response_context);
};

export const extractDemandJob = async (params: {
  serviceClient: SupabaseClient;
  job: DemandJobRow;
  requestId: string;
}): Promise<DemandExtractionResult> => {
  if (params.job.source_kind === "chat_message") {
    return await extractFromChatMessage(params);
  }
  if (params.job.source_kind === "import_provenance") {
    return await extractFromImport(params);
  }
  if (params.job.source_kind === "onboarding_completion") {
    return await extractOnboardingCompletion(params);
  }
  if (params.job.source_kind === "chat_candidate_action") {
    return await extractCandidateAction(params);
  }
  if (params.job.source_kind === "chat_commit") {
    return await extractCommit(params);
  }
  if (params.job.source_kind === "recipe_save") {
    return await extractRecipeSave(params);
  }
  if (params.job.source_kind === "variant_refresh") {
    return await extractVariantRefresh(params);
  }
  if (params.job.source_kind === "behavior_event") {
    return await extractBehaviorEvent(params);
  }

  throw new Error(`unsupported_demand_source:${params.job.source_kind}`);
};

export const attachOutcomeOriginIds = async (params: {
  serviceClient: SupabaseClient;
  observationId: string;
  observation: DemandObservationRecord;
  outcomes: DemandOutcomeRecord[];
}): Promise<DemandOutcomeRecord[]> => {
  if (params.outcomes.length === 0) {
    return [];
  }

  const sourceSessionId = asTrimmedString(params.observation.summary.source_session_id);
  const originObservationId = await findLatestOriginObservation({
    serviceClient: params.serviceClient,
    userId: params.observation.userId,
    chatSessionId: params.observation.chatSessionId,
    recipeId: params.observation.recipeId,
    sourceSessionId,
  });

  const linkedOutcomes: DemandOutcomeRecord[] = [];
  for (const outcome of params.outcomes) {
    let resolvedOutcomeType = outcome.outcomeType;
    if (outcome.outcomeType === "cook_inferred" && params.observation.userId && outcome.recipeId) {
      const { data: priorCook } = await params.serviceClient
        .from("demand_outcomes")
        .select("id")
        .eq("outcome_type", "cook_inferred")
        .eq("recipe_id", outcome.recipeId)
        .order("occurred_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (priorCook?.id) {
        resolvedOutcomeType = "repeat_cook";
      }
    }

    linkedOutcomes.push({
      ...outcome,
      observationId: params.observationId,
      originObservationId,
      outcomeType: isDemandOutcomeType(resolvedOutcomeType) ? resolvedOutcomeType : outcome.outcomeType,
    });
  }

  return linkedOutcomes;
};
