import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  BEHAVIOR_EVENT_DEFINITIONS,
  isBehaviorEventType,
  isBehaviorSurface,
  type BehaviorEventType,
  type BehaviorSurface,
} from "../../../../packages/shared/src/behavior-events.ts";
import type { JsonValue } from "../../_shared/types.ts";

export type BehaviorEventInput = {
  eventId?: string | null;
  userId: string;
  eventType: BehaviorEventType;
  surface?: BehaviorSurface | null;
  occurredAt?: string | null;
  sessionId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  sourceSurface?: string | null;
  algorithmVersion?: string | null;
  payload?: Record<string, JsonValue>;
};

export type BehaviorFactInput = {
  eventId?: string | null;
  userId: string;
  sourceType: string;
  sourceId: string;
  factType: string;
  factValue?: Record<string, JsonValue>;
};

export const normalizeBehaviorEventInput = (
  input: Omit<BehaviorEventInput, "eventType"> & {
    eventType: string;
    surface?: string | null;
  },
): BehaviorEventInput | null => {
  if (!isBehaviorEventType(input.eventType)) {
    return null;
  }

  const defaultSurface = BEHAVIOR_EVENT_DEFINITIONS[input.eventType].surface;
  const surface = input.surface && isBehaviorSurface(input.surface)
    ? input.surface
    : defaultSurface;

  return {
    ...input,
    eventType: input.eventType,
    surface,
  };
};

export const logBehaviorEvents = async (params: {
  serviceClient: SupabaseClient;
  events: BehaviorEventInput[];
}): Promise<void> => {
  if (params.events.length === 0) {
    return;
  }

  const payload = params.events.map((event) => ({
    event_id: event.eventId ?? crypto.randomUUID(),
    user_id: event.userId,
    event_type: event.eventType,
    surface: event.surface ?? BEHAVIOR_EVENT_DEFINITIONS[event.eventType].surface,
    occurred_at: event.occurredAt ?? new Date().toISOString(),
    session_id: event.sessionId ?? null,
    entity_type: event.entityType ?? null,
    entity_id: event.entityId ?? null,
    source_surface: event.sourceSurface ?? null,
    algorithm_version: event.algorithmVersion ?? null,
    payload: event.payload ?? {},
  }));

  const { error } = await params.serviceClient
    .from("behavior_events")
    .upsert(payload, { onConflict: "event_id", ignoreDuplicates: true });

  if (error) {
    console.error("behavior_event_log_failed", error);
  }
};

export const logBehaviorFacts = async (params: {
  serviceClient: SupabaseClient;
  facts: BehaviorFactInput[];
}): Promise<void> => {
  if (params.facts.length === 0) {
    return;
  }

  const { error } = await params.serviceClient
    .from("behavior_semantic_facts")
    .insert(params.facts.map((fact) => ({
      event_id: fact.eventId ?? null,
      user_id: fact.userId,
      source_type: fact.sourceType,
      source_id: fact.sourceId,
      fact_type: fact.factType,
      fact_value: fact.factValue ?? {},
    })));

  if (error) {
    console.error("behavior_fact_log_failed", error);
  }
};

export const buildChatBehaviorFacts = (params: {
  eventId: string;
  userId: string;
  chatId: string;
  responseContext?: Record<string, JsonValue> | null;
  candidateId?: string | null;
  generatedCount?: number | null;
}): BehaviorFactInput[] => {
  const facts: BehaviorFactInput[] = [];
  const responseContext = params.responseContext ?? null;
  const intent = typeof responseContext?.["intent"] === "string"
    ? responseContext["intent"] as string
    : null;
  const mode = typeof responseContext?.["mode"] === "string"
    ? responseContext["mode"] as string
    : null;

  if (intent) {
    facts.push({
      eventId: params.eventId,
      userId: params.userId,
      sourceType: "chat_session",
      sourceId: params.chatId,
      factType: "chat_intent",
      factValue: { intent },
    });
  }

  if (mode) {
    facts.push({
      eventId: params.eventId,
      userId: params.userId,
      sourceType: "chat_session",
      sourceId: params.chatId,
      factType: "chat_mode",
      factValue: { mode },
    });
  }

  if (params.candidateId) {
    facts.push({
      eventId: params.eventId,
      userId: params.userId,
      sourceType: "candidate_set",
      sourceId: params.candidateId,
      factType: "generated_component_count",
      factValue: {
        count: typeof params.generatedCount === "number" ? params.generatedCount : 0,
      },
    });
  }

  return facts;
};
