import {
  ApiError,
  requireJsonBody,
} from "../../_shared/errors.ts";
import { llmGateway } from "../../_shared/llm-gateway.ts";
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
    userClient: RouteContext["client"];
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

    const mergedPresentationPreferences = {
      ...(effectivePreferences.presentation_preferences ?? {}),
      onboarding_state: onboardingState,
    } as Record<string, JsonValue>;

    const { data: persistedPreferences, error: persistedPreferencesError } =
      await client
        .from("preferences")
        .upsert({
          user_id: auth.userId,
          ...effectivePreferences,
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

    void (async () => {
      try {
        await updateMemoryFromInteraction({
          userClient: client,
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
