import type { JsonValue } from "../../../_shared/types.ts";
import type {
  CandidateRecipeSet,
  ChatLoopResponse,
  ChatMessageView,
  ChatSessionContext,
  RouteContext,
} from "../shared.ts";

/**
 * Dependency injection for import route (same pattern as ChatDeps in chat.ts).
 * Keeps the handler testable by externalizing DB-write helpers and side effects.
 */
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
      generation_pending?: boolean;
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
