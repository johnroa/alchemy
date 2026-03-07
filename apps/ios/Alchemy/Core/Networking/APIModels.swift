import Foundation

// MARK: - Cookbook

/// Response from GET /recipes/cookbook.
/// Items are CookbookEntryItem (canonical recipe + variant status),
/// not plain RecipePreview.
struct CookbookResponse: Decodable {
    let items: [CookbookEntryItem]
    let cookbookInsight: String?
}

/// A cookbook entry as returned by GET /recipes/cookbook. Includes canonical
/// recipe preview data plus variant status. When a variant exists, summary
/// and tags reflect the personalised version; title always stays canonical.
struct CookbookEntryItem: Decodable, Identifiable, Hashable {
    let canonicalRecipeId: String
    let title: String
    let summary: String
    let imageUrl: String?
    let imageStatus: String
    let category: String
    let visibility: String
    let updatedAt: String
    let quickStats: RecipeQuickStats?
    let variantStatus: String
    let activeVariantVersionId: String?
    let personalizedAt: String?
    let autopersonalize: Bool
    let savedAt: String
    let variantTags: [String]?

    /// Identifiable conformance uses the canonical recipe ID.
    var id: String { canonicalRecipeId }

    var resolvedImageURL: URL? {
        guard let imageUrl, imageStatus == "ready" else { return nil }
        return URL(string: imageUrl)
    }

    /// Whether the variant is actively personalised (not "none").
    var hasVariant: Bool {
        variantStatus != "none"
    }

    /// Whether the variant needs attention (stale, failed, or needs review).
    var variantNeedsAttention: Bool {
        variantStatus == "stale" || variantStatus == "failed" || variantStatus == "needs_review"
    }
}

/// Shared preview model used by both cookbook items and search/explore results.
/// Maps to the API's RecipePreview schema.
struct RecipePreview: Decodable, Identifiable, Hashable {
    let id: String
    let title: String
    let summary: String
    let imageUrl: String?
    let imageStatus: String
    let category: String
    let visibility: String
    let updatedAt: String
    let quickStats: RecipeQuickStats?

    /// Derives a URL from the image_url string, returns nil when pending/failed.
    var resolvedImageURL: URL? {
        guard let imageUrl, imageStatus == "ready" else { return nil }
        return URL(string: imageUrl)
    }
}

/// Quick stats attached to recipe previews: time, difficulty, health, ingredient count.
/// Maps to the API's RecipeQuickStats schema.
struct RecipeQuickStats: Decodable, Hashable {
    let timeMinutes: Int
    /// "easy", "medium", or "complex" from the API
    let difficulty: String
    let healthScore: Int
    /// Number of ingredient items
    let items: Int

    /// Normalized 0–1 difficulty for gauge rendering.
    var difficultyNormalized: Double {
        switch difficulty {
        case "easy": return 0.25
        case "medium": return 0.55
        case "complex": return 0.85
        default: return 0.5
        }
    }

    /// Normalized 0–1 health score for gauge rendering.
    var healthNormalized: Double {
        Double(healthScore) / 100.0
    }
}

// MARK: - Recipe Detail

/// Full recipe from GET /recipes/{id}. Contains everything needed for
/// the detail view: ingredients, steps, metadata, attachments, version info.
struct RecipeDetail: Decodable, Identifiable {
    let id: String
    let title: String
    let description: String?
    let summary: String
    let servings: Int
    let ingredients: [APIIngredient]
    let steps: [APIStep]
    let ingredientGroups: [APIIngredientGroup]?
    let notes: String?
    let pairings: [String]
    let metadata: RecipeMetadata?
    let emoji: [String]
    let imageUrl: String?
    let imageStatus: String
    let visibility: String
    let updatedAt: String
    let version: RecipeVersionInfo
    let attachments: [RecipeAttachmentView]

    var resolvedImageURL: URL? {
        guard let imageUrl, imageStatus == "ready" else { return nil }
        return URL(string: imageUrl)
    }
}

struct APIIngredient: Decodable, Identifiable, Hashable {
    /// Uses ingredient name as fallback ID since the API doesn't guarantee a stable id field
    var id: String { ingredientId ?? name }
    let name: String
    let amount: AnyCodableValue?
    let unit: String?
    let displayAmount: String?
    let preparation: String?
    let category: String?
    let ingredientId: String?
    let normalizedStatus: String?
    let component: String?

    /// Units that add no useful information for whole countable items
    /// (e.g. "1 piece" of egg → just "1"). Checked case-insensitively.
    private static let redundantUnits: Set<String> = [
        "piece", "pieces", "whole", "unit", "units", "item", "items",
    ]

    /// Formatted display string for the quantity column.
    /// Combines the display_amount (or raw amount) with the unit,
    /// omitting redundant units like "piece" for whole countable items.
    var displayQuantity: String {
        let numericPart: String = {
            if let displayAmount, !displayAmount.isEmpty {
                return displayAmount
            }
            return amount?.stringValue ?? ""
        }()
        if let unit, !unit.isEmpty,
           !Self.redundantUnits.contains(unit.lowercased()) {
            return "\(numericPart) \(unit)"
        }
        return numericPart
    }
}

struct APIStep: Decodable, Identifiable, Hashable {
    var id: String { "\(index)" }
    let index: Int
    let instruction: String
    let timerSeconds: Int?
    let notes: String?
}

struct APIIngredientGroup: Decodable {
    let key: String
    let label: String
    let ingredients: [APIIngredient]
}

struct RecipeVersionInfo: Decodable {
    let versionId: String
    let recipeId: String
    let parentVersionId: String?
    let diffSummary: String?
    let createdAt: String
}

struct RecipeAttachmentView: Decodable, Identifiable {
    var id: String { attachmentId }
    let attachmentId: String
    let relationType: String
    let position: Int
    let recipe: RecipeDetail
}

// MARK: - Recipe Metadata

/// Subset of the full metadata blob relevant to the iOS UI.
/// The API returns metadata as a flexible JSON object; we decode only
/// the fields the UI needs and ignore the rest.
struct RecipeMetadata: Decodable {
    let nutrition: RecipeNutrition?
    let quickStats: RecipeQuickStats?
    let cuisine: String?
    let difficulty: String?
    let timeMinutes: Int?
    let healthScore: Int?
    let vibe: String?
    let allergens: [String]?
    let dietTags: [String]?
    let techniques: [String]?
    let equipment: [String]?
}

struct RecipeNutrition: Decodable, Hashable {
    let calories: Int?
    let proteinG: Double?
    let carbsG: Double?
    let fatG: Double?
    let fiberG: Double?
    let sugarG: Double?
    let sodiumMg: Double?
}

// MARK: - Variant Editing

/// Request body for POST /recipes/{id}/variant/refresh with manual edit instructions.
struct VariantEditRequest: Encodable {
    let instructions: String
}

/// Response from POST /recipes/{id}/variant/refresh.
/// Contains the resulting variant state and any conflicts detected.
struct VariantRefreshResponse: Decodable {
    let variantId: String
    let variantVersionId: String
    let variantStatus: String
    let adaptationSummary: String
    /// Manual edits that conflict with current constraints.
    /// Non-empty → variant is in `needs_review` state.
    let conflicts: [String]?
}

// MARK: - Chat / Generate

/// Full chat session response from POST /chat, POST /chat/{id}/messages, etc.
/// This is the ChatLoopResponse from the API.
struct ChatSessionResponse: Decodable {
    let id: String
    let messages: [APIChatMessage]
    let loopState: ChatLoopState
    let assistantReply: AssistantReply?
    let candidateRecipeSet: APICandidateRecipeSet?
    let responseContext: ChatResponseContext?
    let memoryContextIds: [String]
    let contextVersion: Int
    let uiHints: ChatUiHints?
    let createdAt: String?
    let updatedAt: String?
}

/// Commit response extends ChatSessionResponse with commit details.
struct ChatCommitResponse: Decodable {
    let id: String
    let messages: [APIChatMessage]
    let loopState: ChatLoopState
    let assistantReply: AssistantReply?
    let candidateRecipeSet: APICandidateRecipeSet?
    let commit: CommitResult?
}

struct CommitResult: Decodable {
    let candidateId: String
    let revision: Int
    let committedCount: Int
    let recipes: [CommittedRecipe]
    let links: [CommittedLink]
    let postSaveOptions: [String]
}

struct CommittedRecipe: Decodable {
    let componentId: String
    let role: String
    let title: String
    let recipeId: String
    let recipeVersionId: String
}

struct CommittedLink: Decodable {
    let id: String
    let parentRecipeId: String
    let childRecipeId: String
    let relationType: String
    let position: Int
}

enum ChatLoopState: String, Decodable {
    case ideation
    case candidatePresented = "candidate_presented"
    case iterating
}

struct AssistantReply: Decodable {
    let text: String
    let tone: String?
    let emoji: [String]?
    let suggestedNextActions: [String]?
    let focusSummary: String?
}

struct APICandidateRecipeSet: Decodable {
    let candidateId: String
    let revision: Int
    let activeComponentId: String
    let components: [APICandidateComponent]
}

/// A single component (main, side, dessert, etc.) within a candidate recipe set.
/// The API omits `image_url` and `image_status` on freshly generated candidates
/// before images are enrolled, so both default gracefully (nil / "pending").
struct APICandidateComponent: Decodable, Identifiable {
    var id: String { componentId }
    let componentId: String
    let role: String
    let title: String
    let imageUrl: String?
    let imageStatus: String
    let recipe: RecipePayload

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        componentId = try container.decode(String.self, forKey: .componentId)
        role = try container.decode(String.self, forKey: .role)
        title = try container.decode(String.self, forKey: .title)
        imageUrl = try container.decodeIfPresent(String.self, forKey: .imageUrl)
        imageStatus = try container.decodeIfPresent(String.self, forKey: .imageStatus) ?? "pending"
        recipe = try container.decode(RecipePayload.self, forKey: .recipe)
    }

    private enum CodingKeys: String, CodingKey {
        case componentId, role, title, imageUrl, imageStatus, recipe
    }
}

/// The raw recipe payload shape produced by the LLM during generation.
/// Lacks id, image_url, image_status, updated_at — those only exist
/// after POST /chat/{id}/commit persists the recipe.
struct RecipePayload: Decodable {
    let title: String
    let description: String?
    let servings: Int?
    let ingredients: [APIIngredient]?
    let steps: [APIStep]?
    let notes: String?
    let pairings: [String]?
    let metadata: RecipeMetadata?
    let emoji: [String]?
}

struct APIChatMessage: Decodable, Identifiable {
    let id: String
    let role: String
    let content: String
    let createdAt: String?
}

struct ChatUiHints: Decodable {
    let showGenerationAnimation: Bool?
    let focusComponentId: String?
}

struct ChatResponseContext: Decodable {
    let mode: String?
    let intent: String?
    let changedSections: [String]?
    let personalizationNotes: [String]?
    /// Preference updates extracted by the Sous Chef during conversation.
    /// Each entry describes a single preference field change that was saved.
    let preferenceUpdates: [PreferenceUpdate]?
}

/// A single preference field change surfaced in response_context.
/// Used to synthesize inline "Preferences Saved!" system messages.
struct PreferenceUpdate: Decodable {
    let field: String
    let value: AnyCodableValue
    let action: String?
}

/// Request body for POST /chat (new session) and POST /chat/{id}/messages
struct ChatMessageRequest: Encodable {
    let message: String
}

/// Request body for PATCH /chat/{id}/candidate
struct PatchCandidateRequest: Encodable {
    let action: String
    let componentId: String?
}

/// Chat greeting response from GET /chat/greeting
struct ChatGreetingResponse: Decodable {
    let text: String
}

// MARK: - Onboarding

/// Request body for POST /onboarding/chat
struct OnboardingChatRequest: Encodable {
    let message: String?
    let transcript: [TranscriptEntry]?
}

struct TranscriptEntry: Codable {
    let role: String
    let content: String
    let createdAt: String?
}

/// Response from POST /onboarding/chat
struct OnboardingChatResponse: Decodable {
    let assistantReply: AssistantReply
    let onboardingState: OnboardingStateResponse
    let preferenceUpdates: [String: AnyCodableValue]?
}

/// Response from GET /onboarding/state
struct OnboardingStateResponse: Decodable {
    let completed: Bool
    let progress: Double
    let missingTopics: [String]
}

// MARK: - Preferences

struct PreferenceProfile: Codable {
    var dietaryPreferences: [String]?
    var dietaryRestrictions: [String]?
    var skillLevel: String?
    var equipment: [String]?
    var cuisines: [String]?
    var aversions: [String]?
    var cookingFor: String?
    var maxDifficulty: Double?
    var freeForm: String?
}

// MARK: - Memories

struct MemoryListResponse: Decodable {
    let items: [MemoryItem]
}

struct MemoryItem: Decodable, Identifiable {
    let id: String
    let memoryType: String
    let memoryKind: String?
    let memoryContent: String?
    let confidence: Double
    let salience: Double?
    let status: String
    let updatedAt: String?
}

struct ForgetMemoryRequest: Encodable {
    let memoryId: String
}

// MARK: - Collections

struct CollectionListResponse: Decodable {
    let items: [APICollection]
}

struct APICollection: Decodable, Identifiable {
    let id: String
    let name: String
    let createdAt: String
}

struct CreateCollectionRequest: Encodable {
    let name: String
}

struct AddToCollectionRequest: Encodable {
    let recipeId: String
}

// MARK: - Search / Explore

/// Request body for POST /recipes/search (Explore feed + search)
struct RecipeSearchRequest: Encodable {
    let query: String?
    let presetId: String?
    let cursor: String?
    let limit: Int?
}

/// Response from POST /recipes/search
struct RecipeSearchResponse: Decodable {
    let searchId: String
    let appliedContext: String
    let items: [RecipePreview]
    let nextCursor: String?
    let noMatch: RecipeSearchNoMatch?
}

struct RecipeSearchNoMatch: Decodable {
    let code: String
    let message: String
    let suggestedAction: String?
}

// MARK: - Changelog

struct ChangelogResponse: Decodable {
    let items: [ChangelogEvent]
}

struct ChangelogEvent: Decodable, Identifiable {
    let id: String
    let scope: String
    let entityType: String
    let action: String
    let createdAt: String
}

// MARK: - Flexible JSON Value

/// A type-erased Codable value for handling dynamic JSON fields
/// like metadata and preference_updates where the shape varies.
enum AnyCodableValue: Decodable, Hashable {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let v = try? container.decode(Bool.self) { self = .bool(v) }
        else if let v = try? container.decode(Int.self) { self = .int(v) }
        else if let v = try? container.decode(Double.self) { self = .double(v) }
        else if let v = try? container.decode(String.self) { self = .string(v) }
        else if container.decodeNil() { self = .null }
        else { self = .null }
    }

    var stringValue: String? {
        switch self {
        case .string(let v): return v
        case .int(let v): return String(v)
        case .double(let v): return String(v)
        case .bool(let v): return String(v)
        case .null: return nil
        }
    }
}
