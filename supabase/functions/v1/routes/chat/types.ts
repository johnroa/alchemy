import { llmGateway } from "../../../_shared/llm-gateway.ts";
import type {
  AssistantReply,
  JsonValue,
  RecipePayload,
} from "../../../_shared/types.ts";
import type {
  CandidateRecipeRole,
  CandidateRecipeSet,
  ChatLoopResponse,
  ChatLoopState,
  ChatMessageView,
  ChatSessionContext,
  ContextPack,
  PreferenceContext,
  RouteContext,
} from "../shared.ts";

export type AssistantChatResponse = Awaited<ReturnType<typeof llmGateway.converseChat>>;

export type OrchestratedChatTurn = {
  assistantChatResponse: AssistantChatResponse;
  nextCandidateSet: CandidateRecipeSet | null;
  nextLoopState: ChatLoopState;
  nextContext: ChatSessionContext;
  effectivePreferences: PreferenceContext;
  responseContext: ChatLoopResponse["response_context"] | null;
  justGenerated: boolean;
  generationDeferred: boolean;
};

export type ChatDeps = {
  buildContextPack: (input: {
    userClient: RouteContext["client"];
    serviceClient: RouteContext["serviceClient"];
    userId: string;
    requestId: string;
    prompt: string;
    context: Record<string, JsonValue>;
    selectionMode?: "llm" | "fast";
  }) => Promise<ContextPack>;
  buildThreadForPrompt: (
    messages: ChatMessageView[],
  ) => Array<{ role: string; content: string }>;
  orchestrateChatTurn: (input: {
    client: RouteContext["client"];
    serviceClient: RouteContext["serviceClient"];
    userId: string;
    requestId: string;
    message: string;
    existingCandidate: CandidateRecipeSet | null;
    sessionContext: ChatSessionContext;
    contextPack: ContextPack;
    threadForPrompt: Array<{ role: string; content: string }>;
    modelOverrides?: RouteContext["modelOverrides"];
    deferGeneration?: boolean;
    scopeOverride?: "chat_ideation" | "chat_generation" | "chat_iteration";
  }) => Promise<OrchestratedChatTurn>;
  updateChatSessionLoopContext: (input: {
    client: RouteContext["client"];
    chatId: string;
    context: ChatSessionContext;
  }) => Promise<void>;
  resolveAssistantMessageContent: (
    assistantReply: AssistantReply,
  ) => string;
  enqueueMemoryJob: (input: {
    serviceClient: RouteContext["serviceClient"];
    userId: string;
    chatId: string;
    messageId: string;
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
  buildChatLoopResponse: (input: {
    chatId: string;
    messages: ChatMessageView[];
    context: ChatSessionContext;
    assistantReply?: AssistantReply | null;
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
  extractChatContext: (value: unknown) => ChatSessionContext;
  extractLatestAssistantReply: (
    messages: ChatMessageView[],
  ) => AssistantReply | null;
  normalizeCandidateRecipeSet: (
    candidate: unknown,
  ) => CandidateRecipeSet | null;
  hydrateCandidateRecipeSetImages: (input: {
    serviceClient: RouteContext["serviceClient"];
    chatId: string;
    candidateSet: CandidateRecipeSet;
  }) => Promise<CandidateRecipeSet>;
  enrollCandidateImageRequests: (input: {
    serviceClient: RouteContext["serviceClient"];
    userId: string;
    requestId: string;
    chatId: string;
    candidateSet: CandidateRecipeSet;
  }) => Promise<CandidateRecipeSet>;
  attachCommittedCandidateImages: (input: {
    serviceClient: RouteContext["serviceClient"];
    userId: string;
    requestId: string;
    chatId: string;
    candidateSet: CandidateRecipeSet;
    committedRecipes: Array<{
      component_id: string;
      recipe_id: string;
      recipe_version_id: string;
      recipe: RecipePayload;
      title: string;
    }>;
  }) => Promise<void>;
  deriveLoopState: (
    context: ChatSessionContext,
    candidate: CandidateRecipeSet | null,
  ) => ChatLoopState;
  buildCandidateOutlineForPrompt: (
    candidate: CandidateRecipeSet | null,
  ) => JsonValue;
  parseUuid: (value: string) => string;
  getPreferences: (
    client: RouteContext["client"],
    userId: string,
  ) => Promise<PreferenceContext>;
  canonicalizeRecipePayload: (input: {
    serviceClient: RouteContext["serviceClient"];
    userId: string;
    requestId: string;
    payload: RecipePayload;
    preferences: Record<string, JsonValue>;
    modelOverrides?: RouteContext["modelOverrides"];
  }) => Promise<RecipePayload>;
  persistRecipe: (input: {
    client: RouteContext["client"];
    serviceClient: RouteContext["serviceClient"];
    userId: string;
    requestId: string;
    payload: RecipePayload;
    sourceChatId?: string;
    recipeId?: string;
    parentVersionId?: string;
    diffSummary?: string;
    heroImageUrl?: string;
    imageError?: string;
    selectedMemoryIds?: string[];
  }) => Promise<{ recipeId: string; versionId: string }>;
  resolveAndPersistCanonicalRecipe: (input: {
    client: RouteContext["client"];
    serviceClient: RouteContext["serviceClient"];
    userId: string;
    requestId: string;
    payload: RecipePayload;
    sourceChatId?: string;
    diffSummary?: string;
    selectedMemoryIds?: string[];
    modelOverrides?: RouteContext["modelOverrides"];
  }) => Promise<{
    action: "reuse_existing_version" | "append_existing_canon" | "create_new_canon";
    reason: string;
    recipeId: string;
    versionId: string;
    matchedRecipeId: string | null;
    matchedRecipeVersionId: string | null;
    judgeInvoked: boolean;
    judgeCandidateCount: number;
    judgeConfidence: number | null;
  }>;
  ensurePersistedRecipeImageRequest: (input: {
    serviceClient: RouteContext["serviceClient"];
    userId: string;
    requestId: string;
    recipeId: string;
    recipeVersionId: string;
  }) => Promise<void>;
  scheduleImageQueueDrain: (input: {
    serviceClient: RouteContext["serviceClient"];
    actorUserId: string;
    requestId: string;
    limit?: number;
    modelOverrides?: RouteContext["modelOverrides"];
  }) => void;
  scheduleMemoryQueueDrain: (input: {
    serviceClient: RouteContext["serviceClient"];
    actorUserId: string;
    requestId: string;
    limit?: number;
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
  mapCandidateRoleToRelation: (role: CandidateRecipeRole) => string;
  resolveRelationTypeId: (
    client: RouteContext["client"] | RouteContext["serviceClient"],
    relationType: string,
  ) => Promise<string>;
  fetchChatMessages: (
    client: RouteContext["client"],
    chatId: string,
    limit?: number,
  ) => Promise<ChatMessageView[]>;
};
