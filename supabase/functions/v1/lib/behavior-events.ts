import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  isAcquisitionChannel,
  type AcquisitionChannel,
  type LifecycleStage,
} from "../../../../packages/shared/src/acquisition.ts";
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
  userId?: string | null;
  installId?: string | null;
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

type InstallProfileRow = {
  install_id: string;
  acquisition_channel: AcquisitionChannel;
  campaign_token: string | null;
  provider_token: string | null;
  first_opened_at: string;
  last_seen_at: string;
  snapshot: Record<string, JsonValue> | null;
};

type UserAcquisitionProfileRow = {
  user_id: string;
  install_id: string | null;
  acquisition_channel: AcquisitionChannel;
  lifecycle_stage: LifecycleStage;
  signed_in_at: string | null;
  onboarding_started_at: string | null;
  onboarding_completed_at: string | null;
  first_generation_at: string | null;
  first_save_at: string | null;
  first_cook_at: string | null;
  last_seen_at: string | null;
};

const isRecord = (value: unknown): value is Record<string, JsonValue> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const coerceInstallId = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length < 8 || trimmed.length > 128) {
    return null;
  }

  return trimmed;
};

const stringFromJson = (value: JsonValue | undefined): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const normalizeAcquisitionChannel = (
  value: JsonValue | undefined,
): AcquisitionChannel | null => {
  const candidate = stringFromJson(value);
  return candidate && isAcquisitionChannel(candidate) ? candidate : null;
};

const maxIsoTimestamp = (left: string | null | undefined, right: string): string =>
  !left || Date.parse(right) > Date.parse(left) ? right : left;

const eventCreatesFirstGeneration = (event: BehaviorEventInput): boolean => {
  if (event.eventType !== "chat_turn_resolved") {
    return false;
  }

  return isRecord(event.payload) && event.payload["triggered_recipe"] === true;
};

const computeLifecycleStage = (profile: {
  lastSeenAt: string | null;
  onboardingCompletedAt: string | null;
  firstGenerationAt: string | null;
  firstSaveAt: string | null;
  firstCookAt: string | null;
}): LifecycleStage => {
  if (profile.lastSeenAt) {
    const daysSinceSeen = (Date.now() - Date.parse(profile.lastSeenAt)) / 86_400_000;
    if (
      daysSinceSeen >= 14 &&
      (profile.firstGenerationAt || profile.firstSaveAt || profile.firstCookAt)
    ) {
      return "at_risk";
    }
  }

  if (profile.firstCookAt) {
    return "habit";
  }
  if (profile.firstSaveAt) {
    return "saved";
  }
  if (profile.firstGenerationAt || profile.onboardingCompletedAt) {
    return "activated";
  }
  return "new";
};

const upsertInstallProfile = async (
  serviceClient: SupabaseClient,
  event: BehaviorEventInput,
): Promise<InstallProfileRow | null> => {
  const installId = coerceInstallId(event.installId);
  if (!installId) {
    return null;
  }

  const occurredAt = event.occurredAt ?? new Date().toISOString();
  const snapshot = isRecord(event.payload) ? event.payload : {};
  const channel = normalizeAcquisitionChannel(snapshot["acquisition_channel"]);
  const campaignToken = stringFromJson(snapshot["campaign_token"]);
  const providerToken = stringFromJson(snapshot["provider_token"]);

  const { data: existing, error: existingError } = await serviceClient
    .from("install_profiles")
    .select("install_id, acquisition_channel, campaign_token, provider_token, first_opened_at, last_seen_at, snapshot")
    .eq("install_id", installId)
    .maybeSingle();

  if (existingError) {
    console.error("install_profile_lookup_failed", existingError);
    return null;
  }

  const existingRow = (existing ?? null) as InstallProfileRow | null;
  const nextRow = {
    install_id: installId,
    acquisition_channel: existingRow && existingRow.acquisition_channel !== "unknown"
      ? existingRow.acquisition_channel
      : channel ?? "unknown",
    campaign_token: existingRow?.campaign_token ?? campaignToken,
    provider_token: existingRow?.provider_token ?? providerToken,
    first_opened_at: existingRow?.first_opened_at ??
      (event.eventType === "app_first_open" ? occurredAt : occurredAt),
    last_seen_at: maxIsoTimestamp(existingRow?.last_seen_at, occurredAt),
    snapshot: existingRow?.snapshot && Object.keys(existingRow.snapshot).length > 0
      ? existingRow.snapshot
      : snapshot,
    updated_at: new Date().toISOString(),
  };

  if (!existingRow) {
    const { data, error } = await serviceClient
      .from("install_profiles")
      .insert({
        ...nextRow,
        created_at: new Date().toISOString(),
      })
      .select("install_id, acquisition_channel, campaign_token, provider_token, first_opened_at, last_seen_at, snapshot")
      .single();

    if (error) {
      console.error("install_profile_insert_failed", error);
      return null;
    }

    return data as InstallProfileRow;
  }

  const { data, error } = await serviceClient
    .from("install_profiles")
    .update(nextRow)
    .eq("install_id", installId)
    .select("install_id, acquisition_channel, campaign_token, provider_token, first_opened_at, last_seen_at, snapshot")
    .single();

  if (error) {
    console.error("install_profile_update_failed", error);
    return null;
  }

  return data as InstallProfileRow;
};

const upsertUserAcquisitionProfile = async (
  serviceClient: SupabaseClient,
  event: BehaviorEventInput,
  installProfile: InstallProfileRow | null,
): Promise<void> => {
  if (!event.userId) {
    return;
  }

  const occurredAt = event.occurredAt ?? new Date().toISOString();
  const installId = coerceInstallId(event.installId);
  const { data: existing, error: existingError } = await serviceClient
    .from("user_acquisition_profiles")
    .select("user_id, install_id, acquisition_channel, lifecycle_stage, signed_in_at, onboarding_started_at, onboarding_completed_at, first_generation_at, first_save_at, first_cook_at, last_seen_at")
    .eq("user_id", event.userId)
    .maybeSingle();

  if (existingError) {
    console.error("user_acquisition_profile_lookup_failed", existingError);
    return;
  }

  const existingRow = (existing ?? null) as UserAcquisitionProfileRow | null;
  const nextSignedInAt = existingRow?.signed_in_at ??
    (event.eventType === "auth_completed" ? occurredAt : null);
  const nextOnboardingStartedAt = existingRow?.onboarding_started_at ??
    (event.eventType === "onboarding_started" ? occurredAt : null);
  const nextOnboardingCompletedAt = existingRow?.onboarding_completed_at ??
    (event.eventType === "onboarding_completed" ? occurredAt : null);
  const nextFirstGenerationAt = existingRow?.first_generation_at ??
    (eventCreatesFirstGeneration(event) ? occurredAt : null);
  const nextFirstSaveAt = existingRow?.first_save_at ??
    (event.eventType === "recipe_saved" ? occurredAt : null);
  const nextFirstCookAt = existingRow?.first_cook_at ??
    (event.eventType === "recipe_cooked_inferred" ? occurredAt : null);
  const nextLastSeenAt = maxIsoTimestamp(existingRow?.last_seen_at, occurredAt);
  const nextLifecycleStage = computeLifecycleStage({
    lastSeenAt: nextLastSeenAt,
    onboardingCompletedAt: nextOnboardingCompletedAt,
    firstGenerationAt: nextFirstGenerationAt,
    firstSaveAt: nextFirstSaveAt,
    firstCookAt: nextFirstCookAt,
  });

  const nextRow = {
    user_id: event.userId,
    install_id: existingRow?.install_id ?? installId,
    acquisition_channel: existingRow && existingRow.acquisition_channel !== "unknown"
      ? existingRow.acquisition_channel
      : installProfile?.acquisition_channel ?? "unknown",
    lifecycle_stage: nextLifecycleStage,
    signed_in_at: nextSignedInAt,
    onboarding_started_at: nextOnboardingStartedAt,
    onboarding_completed_at: nextOnboardingCompletedAt,
    first_generation_at: nextFirstGenerationAt,
    first_save_at: nextFirstSaveAt,
    first_cook_at: nextFirstCookAt,
    last_seen_at: nextLastSeenAt,
    updated_at: new Date().toISOString(),
  };

  if (!existingRow) {
    const { error } = await serviceClient.from("user_acquisition_profiles").insert({
      ...nextRow,
      created_at: new Date().toISOString(),
    });
    if (error) {
      console.error("user_acquisition_profile_insert_failed", error);
    }
    return;
  }

  const { error } = await serviceClient
    .from("user_acquisition_profiles")
    .update(nextRow)
    .eq("user_id", event.userId);

  if (error) {
    console.error("user_acquisition_profile_update_failed", error);
  }
};

export const getInstallIdFromHeaders = (request: Request): string | null =>
  coerceInstallId(request.headers.get("x-install-id"));

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
    installId: coerceInstallId(input.installId),
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
    user_id: event.userId ?? null,
    install_id: coerceInstallId(event.installId),
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
    return;
  }

  for (const event of params.events) {
    const installProfile = await upsertInstallProfile(params.serviceClient, event);
    await upsertUserAcquisitionProfile(params.serviceClient, event, installProfile);
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
