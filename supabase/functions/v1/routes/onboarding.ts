import {
  ApiError,
  requireJsonBody,
} from "../../_shared/errors.ts";
import { llmGateway } from "../../_shared/llm-gateway.ts";
import { getInstallIdFromHeaders, logBehaviorEvents } from "../lib/behavior-events.ts";
import type {
  JsonValue,
  OnboardingState,
} from "../../_shared/types.ts";
import type {
  ContextPack,
  PreferenceContext,
  RouteContext,
} from "./shared.ts";

type OnboardingDeps = {
  getPreferences: (
    client: RouteContext["client"],
    userId: string,
  ) => Promise<PreferenceContext>;
  extractOnboardingStateFromPreferences: (
    preferences: PreferenceContext,
  ) => OnboardingState | null;
  deriveOnboardingStateFromPreferences: (
    preferences: PreferenceContext,
  ) => OnboardingState;
  buildContextPack: (input: {
    userClient: RouteContext["client"];
    serviceClient: RouteContext["serviceClient"];
    userId: string;
    requestId: string;
    prompt: string;
    context: Record<string, JsonValue>;
    selectionMode?: "llm" | "fast";
  }) => Promise<ContextPack>;
  applyModelPreferenceUpdates: (input: {
    client: RouteContext["client"];
    serviceClient: RouteContext["serviceClient"];
    userId: string;
    requestId: string;
    currentPreferences: PreferenceContext;
    preferenceUpdates: Record<string, JsonValue>;
    latestUserMessage: string;
    userMessages: string[];
  }) => Promise<PreferenceContext>;
  updateMemoryFromInteraction: (input: {
    serviceClient: RouteContext["serviceClient"];
    userId: string;
    requestId: string;
    interactionContext: Record<string, JsonValue>;
  }) => Promise<void>;
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
  enqueueDemandExtractionJob?: (input: {
    serviceClient: RouteContext["serviceClient"];
    sourceKind: string;
    sourceId: string;
    userId?: string | null;
    stage: "intent" | "iteration" | "import" | "selection" | "commit" | "consumption" | "feedback";
    extractorScope: string;
    extractorVersion?: number;
    observedAt?: string | null;
    payload?: Record<string, JsonValue>;
  }) => Promise<void>;
  scheduleDemandQueueDrain?: (input: {
    serviceClient: RouteContext["serviceClient"];
    actorUserId: string;
    requestId: string;
    limit?: number;
  }) => void;
};

export const handleOnboardingRoutes = async (
  context: RouteContext,
  deps: OnboardingDeps,
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
  } = context;
  const {
    getPreferences,
    extractOnboardingStateFromPreferences,
    deriveOnboardingStateFromPreferences,
    buildContextPack,
    applyModelPreferenceUpdates,
    updateMemoryFromInteraction,
    logChangelog,
    enqueueDemandExtractionJob,
    scheduleDemandQueueDrain,
  } = deps;

  if (
    segments.length === 2 &&
    segments[0] === "onboarding" &&
    segments[1] === "state" &&
    method === "GET"
  ) {
    const preferences = await getPreferences(client, auth.userId);
    const storedState = extractOnboardingStateFromPreferences(preferences);
    const derivedState = deriveOnboardingStateFromPreferences(preferences);

    const onboardingState = storedState && storedState.completed
      ? storedState
      : {
        ...derivedState,
        state: storedState?.state ?? {},
      };

    return respond(200, onboardingState);
  }

  if (
    segments.length === 2 &&
    segments[0] === "onboarding" &&
    segments[1] === "chat" &&
    method === "POST"
  ) {
    const body = await requireJsonBody<{
      message?: string;
      transcript?: Array<{ role?: string; content?: string; created_at?: string }>;
      state?: Record<string, JsonValue>;
    }>(request);

    const normalizedMessage = typeof body.message === "string"
      ? body.message.trim()
      : "";
    const transcript = Array.isArray(body.transcript)
      ? body.transcript
        .filter((entry) =>
          entry &&
          typeof entry.content === "string" &&
          typeof entry.role === "string"
        )
        .map((entry) => ({
          role: entry.role === "assistant" ? "assistant" : "user",
          content: entry.content?.trim() ?? "",
          created_at: typeof entry.created_at === "string"
            ? entry.created_at
            : null,
        }))
        .filter((entry) => entry.content.length > 0)
      : [];
    const state = body.state &&
        typeof body.state === "object" &&
        !Array.isArray(body.state)
      ? body.state
      : {};

    const contextPack = await buildContextPack({
      userClient: client,
      serviceClient,
      userId: auth.userId,
      requestId,
      prompt: normalizedMessage || "start onboarding",
      context: {
        workflow: "onboarding",
        transcript,
        state,
      },
      selectionMode: "fast",
    });

    const interview = await llmGateway.runOnboardingInterview({
      client: serviceClient,
      userId: auth.userId,
      requestId,
      prompt: normalizedMessage || "start onboarding",
      context: {
        preferences: contextPack.preferences,
        preferences_natural_language: contextPack.preferencesNaturalLanguage,
        memory_snapshot: contextPack.memorySnapshot,
        selected_memories: contextPack.selectedMemories,
        transcript,
        state,
      },
    });

    const effectivePreferences = await applyModelPreferenceUpdates({
      client,
      serviceClient,
      userId: auth.userId,
      requestId,
      currentPreferences: contextPack.preferences,
      preferenceUpdates: interview.preference_updates ?? {},
      latestUserMessage: normalizedMessage,
      userMessages: transcript
        .filter((entry) => entry.role === "user")
        .map((entry) => entry.content),
    });

    const inferredState = deriveOnboardingStateFromPreferences(
      effectivePreferences,
    );
    const userSkipRequested = normalizedMessage.length > 0 &&
      /\b(skip|later|not now|start using|use the app|done for now|skip onboarding)\b/i
        .test(normalizedMessage);

    // Completion authority: only the LLM or an explicit user skip can end
    // the conversation. The inferred state (derived from stored preferences)
    // feeds progress tracking but must NOT force completion — doing so causes
    // the "Let's Cook" button to appear while the assistant is still asking
    // a follow-up question, since the reply was generated before the
    // override and doesn't know the conversation is being cut short.
    const onboardingState: OnboardingState = userSkipRequested
      ? {
        completed: true,
        progress: 1,
        missing_topics: [],
        state: {
          ...interview.onboarding_state.state,
          skip_requested: true,
        },
      }
      : interview.onboarding_state.completed
      ? {
        completed: true,
        progress: 1,
        missing_topics: [],
        state: {
          ...interview.onboarding_state.state,
          readiness_inferred: inferredState.completed,
        },
      }
      : {
        completed: false,
        progress: Math.max(
          interview.onboarding_state.progress,
          inferredState.progress,
        ),
        missing_topics: Array.from(
          new Set([
            ...interview.onboarding_state.missing_topics,
            ...inferredState.missing_topics,
          ]),
        ),
        state: interview.onboarding_state.state,
      };

    // Build merged presentation_preferences with onboarding_state.
    // CRITICAL: Only update presentation_preferences — do NOT spread
    // effectivePreferences into a full-row upsert. applyModelPreferenceUpdates
    // already did a safe partial .update() for LLM-changed fields. A full
    // upsert here would overwrite preferences with stale data loaded at
    // request start, causing repeated preference wipes when the LLM returns
    // empty arrays or when another request modified preferences concurrently.
    const { data: currentPrefRow } = await client
      .from("preferences")
      .select("presentation_preferences")
      .eq("user_id", auth.userId)
      .single();

    const currentPresentationPrefs =
      currentPrefRow?.presentation_preferences &&
      typeof currentPrefRow.presentation_preferences === "object" &&
      !Array.isArray(currentPrefRow.presentation_preferences)
        ? (currentPrefRow.presentation_preferences as Record<string, JsonValue>)
        : {};

    const mergedPresentationPreferences = {
      ...currentPresentationPrefs,
      onboarding_state: onboardingState,
    } as Record<string, JsonValue>;

    // Use upsert with ONLY user_id + presentation_preferences. The
    // user_id is needed for the upsert's on-conflict key (first
    // onboarding call may not have a preferences row yet). We
    // intentionally do NOT spread effectivePreferences — that would
    // overwrite fields with stale data from the request-start snapshot.
    const { data: persistedPreferences, error: persistedPreferencesError } =
      await client
        .from("preferences")
        .upsert({
          user_id: auth.userId,
          presentation_preferences: mergedPresentationPreferences,
          updated_at: new Date().toISOString(),
        })
        .select("*")
        .single();

    if (persistedPreferencesError) {
      throw new ApiError(
        500,
        "onboarding_preferences_persist_failed",
        "Could not persist onboarding preferences",
        persistedPreferencesError.message,
      );
    }

    const installId = getInstallIdFromHeaders(request);
    const { data: acquisitionProfile } = await serviceClient
      .from("user_acquisition_profiles")
      .select("onboarding_started_at, onboarding_completed_at")
      .eq("user_id", auth.userId)
      .maybeSingle();

    const milestoneEvents = [];
    if (!acquisitionProfile?.onboarding_started_at) {
      milestoneEvents.push({
        eventId: crypto.randomUUID(),
        userId: auth.userId,
        installId,
        eventType: "onboarding_started" as const,
        entityType: "user",
        entityId: auth.userId,
        payload: {
          workflow: "onboarding",
        },
      });
    }
    if (onboardingState.completed && !acquisitionProfile?.onboarding_completed_at) {
      milestoneEvents.push({
        eventId: crypto.randomUUID(),
        userId: auth.userId,
        installId,
        eventType: "onboarding_completed" as const,
        entityType: "user",
        entityId: auth.userId,
        payload: {
          workflow: "onboarding",
        },
      });
    }

    await logBehaviorEvents({
      serviceClient,
      events: milestoneEvents,
    });

    if (onboardingState.completed && enqueueDemandExtractionJob) {
      await enqueueDemandExtractionJob({
        serviceClient,
        sourceKind: "onboarding_completion",
        sourceId: `${auth.userId}:${requestId}`,
        userId: auth.userId,
        stage: "intent",
        extractorScope: "demand_extract_observation",
        observedAt: new Date().toISOString(),
        payload: {
          latest_message: normalizedMessage as JsonValue,
          onboarding_state: onboardingState as unknown as JsonValue,
          preference_updates: (interview.preference_updates ?? {}) as JsonValue,
          effective_preferences:
            persistedPreferences as unknown as Record<string, JsonValue>,
        },
      });
      scheduleDemandQueueDrain?.({
        serviceClient,
        actorUserId: auth.userId,
        requestId,
        limit: 1,
      });
    }

    void (async () => {
      try {
        await updateMemoryFromInteraction({
          serviceClient,
          userId: auth.userId,
          requestId,
          interactionContext: {
            workflow: "onboarding",
            user_message: normalizedMessage,
            transcript,
            assistant_reply: interview.assistant_reply,
            onboarding_state: onboardingState,
            preference_updates: interview.preference_updates ?? {},
            effective_preferences:
              persistedPreferences as unknown as Record<string, JsonValue>,
          },
        });
        await logChangelog({
          serviceClient,
          actorUserId: auth.userId,
          scope: "onboarding",
          entityType: "preferences",
          entityId: auth.userId,
          action: onboardingState.completed ? "completed" : "step",
          requestId,
          afterJson: {
            onboarding_state: onboardingState,
            preference_updates: interview.preference_updates ?? {},
          },
        });
      } catch (backgroundError) {
        console.error("onboarding_background_task_failed", backgroundError);
      }
    })();

    return respond(200, {
      assistant_reply: interview.assistant_reply,
      onboarding_state: onboardingState,
      preference_updates: interview.preference_updates ?? {},
    });
  }

  return null;
};
