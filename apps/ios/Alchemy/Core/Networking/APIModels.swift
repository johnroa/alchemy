import Foundation

// MARK: - Flexible JSON Value

/// Represents any JSON value for opaque fields the client passes through without inspecting.
enum JSONValue: Codable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case null
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let b = try? container.decode(Bool.self) {
            self = .bool(b)
        } else if let n = try? container.decode(Double.self) {
            self = .number(n)
        } else if let s = try? container.decode(String.self) {
            self = .string(s)
        } else if let arr = try? container.decode([JSONValue].self) {
            self = .array(arr)
        } else if let obj = try? container.decode([String: JSONValue].self) {
            self = .object(obj)
        } else {
            self = .null
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let s): try container.encode(s)
        case .number(let n): try container.encode(n)
        case .bool(let b): try container.encode(b)
        case .null: try container.encodeNil()
        case .array(let a): try container.encode(a)
        case .object(let o): try container.encode(o)
        }
    }
}

// MARK: - Recipe Models

struct RecipeIngredient: Codable, Identifiable {
    var id: String { "\(name)-\(amount)\(unit)" }

    let name: String
    let amount: Double
    let unit: String
    var displayAmount: String?
    var preparation: String?
    var category: String?

    enum CodingKeys: String, CodingKey {
        case name, amount, unit, preparation, category
        case displayAmount = "display_amount"
    }
}

struct InlineMeasurement: Codable {
    let ingredient: String
    let amount: Double
    let unit: String
}

struct RecipeStep: Codable, Identifiable {
    var id: Int { index }

    let index: Int
    let instruction: String
    var timerSeconds: Int?
    var notes: String?
    var inlineMeasurements: [InlineMeasurement]?

    enum CodingKeys: String, CodingKey {
        case index, instruction, notes
        case timerSeconds = "timer_seconds"
        case inlineMeasurements = "inline_measurements"
    }
}

struct RecipeNutrition: Codable {
    var calories: Double?
    var proteinG: Double?
    var carbsG: Double?
    var fatG: Double?
    var fiberG: Double?
    var sugarG: Double?
    var sodiumMg: Double?

    enum CodingKeys: String, CodingKey {
        case calories
        case proteinG = "protein_g"
        case carbsG = "carbs_g"
        case fatG = "fat_g"
        case fiberG = "fiber_g"
        case sugarG = "sugar_g"
        case sodiumMg = "sodium_mg"
    }
}

struct RecipeTiming: Codable {
    var prepMinutes: Int?
    var cookMinutes: Int?
    var totalMinutes: Int?

    enum CodingKeys: String, CodingKey {
        case prepMinutes = "prep_minutes"
        case cookMinutes = "cook_minutes"
        case totalMinutes = "total_minutes"
    }
}

struct RecipeSubstitution: Codable {
    let from: String
    let to: String
    var note: String?
}

struct RecipeMetadata: Codable {
    var vibe: String?
    var flavorProfile: [String]?
    var nutrition: RecipeNutrition?
    var difficulty: String?
    var allergens: [String]?
    var substitutions: [RecipeSubstitution]?
    var timing: RecipeTiming?
    var cuisineTags: [String]?
    var occasionTags: [String]?
    var pairingRationale: [String]?
    var servingNotes: [String]?

    enum CodingKeys: String, CodingKey {
        case vibe, nutrition, difficulty, allergens, substitutions, timing
        case flavorProfile = "flavor_profile"
        case cuisineTags = "cuisine_tags"
        case occasionTags = "occasion_tags"
        case pairingRationale = "pairing_rationale"
        case servingNotes = "serving_notes"
    }
}

struct RecipeVersion: Codable {
    let versionId: String
    let recipeId: String
    var parentVersionId: String?
    var diffSummary: String?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case versionId = "version_id"
        case recipeId = "recipe_id"
        case parentVersionId = "parent_version_id"
        case diffSummary = "diff_summary"
        case createdAt = "created_at"
    }
}

struct RecipeAttachment: Codable, Identifiable {
    var id: String { attachmentId }

    let attachmentId: String
    let relationType: String
    let position: Int
    let recipe: RecipeView

    enum CodingKeys: String, CodingKey {
        case attachmentId = "attachment_id"
        case relationType = "relation_type"
        case position, recipe
    }
}

struct RecipeView: Codable, Identifiable {
    let id: String
    let title: String
    var description: String?
    let summary: String
    var imageUrl: String?
    var imageStatus: String?
    let servings: Int
    let ingredients: [RecipeIngredient]
    let steps: [RecipeStep]
    var notes: String?
    let pairings: [String]
    var metadata: RecipeMetadata?
    var emoji: [String]?
    let visibility: String
    let updatedAt: String
    var attachments: [RecipeAttachment]?
    var category: String?
    var version: RecipeVersion?

    enum CodingKeys: String, CodingKey {
        case id, title, description, summary, servings, ingredients, steps
        case notes, pairings, metadata, emoji, visibility, attachments, category, version
        case imageUrl = "image_url"
        case imageStatus = "image_status"
        case updatedAt = "updated_at"
    }
}

struct RecipeCard: Codable, Identifiable {
    let id: String
    let title: String
    let summary: String
    var imageUrl: String?
    var imageStatus: String?
    var category: String?

    enum CodingKeys: String, CodingKey {
        case id, title, summary, category
        case imageUrl = "image_url"
        case imageStatus = "image_status"
    }
}

// MARK: - Chat Recipe Payload (LLM-generated, pre-save)

/// Normalized recipe payload returned by chat-loop candidate components.
struct RecipePayload: Codable {
    let title: String
    var description: String?
    let servings: Int
    let ingredients: [RecipeIngredient]
    let steps: [RecipeStep]
    var notes: String?
    var pairings: [String]?
    var emoji: [String]?
    var metadata: RecipeMetadata?

    /// Convert to a display-friendly RecipeView with placeholder DB fields.
    func asRecipeView(id: String = "draft", updatedAt: String = "") -> RecipeView {
        RecipeView(
            id: id,
            title: title,
            description: description,
            summary: description ?? title,
            imageUrl: nil,
            imageStatus: nil,
            servings: servings,
            ingredients: ingredients,
            steps: steps,
            notes: notes,
            pairings: pairings ?? [],
            metadata: metadata,
            emoji: emoji,
            visibility: "draft",
            updatedAt: updatedAt,
            attachments: nil,
            category: nil,
            version: nil
        )
    }
}

// MARK: - Chat / Assistant Models

struct AssistantReply: Codable {
    let text: String
    var tone: String?
    var emoji: [String]?
    var suggestedNextActions: [String]?
    var focusSummary: String?

    enum CodingKeys: String, CodingKey {
        case text, tone, emoji
        case suggestedNextActions = "suggested_next_actions"
        case focusSummary = "focus_summary"
    }
}

struct ChatMessageItem: Codable, Identifiable {
    let id: String
    let role: String
    let content: String
    var createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id, role, content
        case createdAt = "created_at"
    }
}

enum ChatLoopState: String, Codable {
    case ideation
    case candidatePresented = "candidate_presented"
    case iterating
}

enum CandidateComponentRole: String, Codable {
    case main
    case side
    case appetizer
    case dessert
    case drink
}

struct CandidateRecipeComponent: Codable, Identifiable {
    let componentId: String
    let role: CandidateComponentRole
    let title: String
    let recipe: RecipePayload

    enum CodingKeys: String, CodingKey {
        case role, title, recipe
        case componentId = "component_id"
    }

    var id: String { componentId }
}

struct CandidateRecipeSet: Codable {
    let candidateId: String
    let revision: Int
    var activeComponentId: String
    var components: [CandidateRecipeComponent]

    enum CodingKeys: String, CodingKey {
        case revision, components
        case candidateId = "candidate_id"
        case activeComponentId = "active_component_id"
    }
}

struct ChatUiHints: Codable {
    var showGenerationAnimation: Bool?
    var focusComponentId: String?

    enum CodingKeys: String, CodingKey {
        case showGenerationAnimation = "show_generation_animation"
        case focusComponentId = "focus_component_id"
    }
}

struct ChatSession: Codable, Identifiable {
    let id: String
    var messages: [ChatMessageItem]
    var loopState: ChatLoopState
    var assistantReply: AssistantReply?
    var candidateRecipeSet: CandidateRecipeSet?
    var memoryContextIds: [String]
    var contextVersion: Int
    var uiHints: ChatUiHints?
    var createdAt: String?
    var updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case id, messages
        case loopState = "loop_state"
        case assistantReply = "assistant_reply"
        case candidateRecipeSet = "candidate_recipe_set"
        case memoryContextIds = "memory_context_ids"
        case contextVersion = "context_version"
        case uiHints = "ui_hints"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

struct PatchCandidateRequest: Encodable {
    enum Action: String, Encodable {
        case setActiveComponent = "set_active_component"
        case deleteComponent = "delete_component"
        case clearCandidate = "clear_candidate"
    }

    let action: Action
    let componentId: String?

    enum CodingKeys: String, CodingKey {
        case action
        case componentId = "component_id"
    }

    static func setActiveComponent(_ componentId: String) -> PatchCandidateRequest {
        PatchCandidateRequest(action: .setActiveComponent, componentId: componentId)
    }

    static func deleteComponent(_ componentId: String) -> PatchCandidateRequest {
        PatchCandidateRequest(action: .deleteComponent, componentId: componentId)
    }

    static func clearCandidate() -> PatchCandidateRequest {
        PatchCandidateRequest(action: .clearCandidate, componentId: nil)
    }
}

struct CommitRecipeItem: Codable, Identifiable {
    let componentId: String
    let role: CandidateComponentRole
    let title: String
    let recipeId: String
    let recipeVersionId: String

    enum CodingKeys: String, CodingKey {
        case role, title
        case componentId = "component_id"
        case recipeId = "recipe_id"
        case recipeVersionId = "recipe_version_id"
    }

    var id: String { componentId }
}

struct CommitRecipeLink: Codable, Identifiable {
    let id: String
    let parentRecipeId: String
    let childRecipeId: String
    let relationType: String
    let position: Int

    enum CodingKeys: String, CodingKey {
        case id, position
        case parentRecipeId = "parent_recipe_id"
        case childRecipeId = "child_recipe_id"
        case relationType = "relation_type"
    }
}

struct CommitPayload: Codable {
    let candidateId: String
    let revision: Int
    let committedCount: Int
    let recipes: [CommitRecipeItem]
    let links: [CommitRecipeLink]
    let postSaveOptions: [String]

    enum CodingKeys: String, CodingKey {
        case revision, recipes, links
        case candidateId = "candidate_id"
        case committedCount = "committed_count"
        case postSaveOptions = "post_save_options"
    }
}

struct CommitChatRecipesResponse: Codable {
    let id: String
    var messages: [ChatMessageItem]
    var loopState: ChatLoopState
    var assistantReply: AssistantReply?
    var candidateRecipeSet: CandidateRecipeSet?
    var memoryContextIds: [String]
    var contextVersion: Int
    var uiHints: ChatUiHints?
    var createdAt: String?
    var updatedAt: String?
    let commit: CommitPayload

    enum CodingKeys: String, CodingKey {
        case id, messages, commit
        case loopState = "loop_state"
        case assistantReply = "assistant_reply"
        case candidateRecipeSet = "candidate_recipe_set"
        case memoryContextIds = "memory_context_ids"
        case contextVersion = "context_version"
        case uiHints = "ui_hints"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }

    var session: ChatSession {
        ChatSession(
            id: id,
            messages: messages,
            loopState: loopState,
            assistantReply: assistantReply,
            candidateRecipeSet: candidateRecipeSet,
            memoryContextIds: memoryContextIds,
            contextVersion: contextVersion,
            uiHints: uiHints,
            createdAt: createdAt,
            updatedAt: updatedAt
        )
    }
}

// MARK: - Preference Models

struct PreferenceProfile: Codable {
    var freeForm: String?
    var dietaryPreferences: [String]
    var dietaryRestrictions: [String]
    var skillLevel: String
    var equipment: [String]
    var cuisines: [String]
    var aversions: [String]
    var cookingFor: String?
    var maxDifficulty: Int
    var presentationPreferences: [String: JSONValue]?

    enum CodingKeys: String, CodingKey {
        case equipment, cuisines, aversions
        case freeForm = "free_form"
        case dietaryPreferences = "dietary_preferences"
        case dietaryRestrictions = "dietary_restrictions"
        case skillLevel = "skill_level"
        case cookingFor = "cooking_for"
        case maxDifficulty = "max_difficulty"
        case presentationPreferences = "presentation_preferences"
    }
}

// MARK: - Onboarding Models

struct OnboardingChatMessage: Codable {
    let role: String
    let content: String
    var createdAt: String?

    enum CodingKeys: String, CodingKey {
        case role, content
        case createdAt = "created_at"
    }
}

struct OnboardingState: Codable {
    let completed: Bool
    let progress: Double
    let missingTopics: [String]
    var state: [String: JSONValue]?

    enum CodingKeys: String, CodingKey {
        case completed, progress, state
        case missingTopics = "missing_topics"
    }
}

struct OnboardingChatResponse: Codable {
    let assistantReply: AssistantReply
    let onboardingState: OnboardingState
    var preferenceUpdates: [String: JSONValue]?

    enum CodingKeys: String, CodingKey {
        case assistantReply = "assistant_reply"
        case onboardingState = "onboarding_state"
        case preferenceUpdates = "preference_updates"
    }
}

// MARK: - Memory Models

struct MemoryItem: Codable, Identifiable {
    let id: String
    let memoryType: String
    let memoryKind: String
    let confidence: Double
    let salience: Double
    let status: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case id, confidence, salience, status
        case memoryType = "memory_type"
        case memoryKind = "memory_kind"
        case updatedAt = "updated_at"
    }
}

struct MemoriesResponse: Codable {
    let items: [MemoryItem]
    var snapshot: [String: JSONValue]?
}

// MARK: - Changelog Models

struct ChangelogItem: Codable, Identifiable {
    let id: String
    let scope: String
    let entityType: String
    let action: String
    var requestId: String?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, scope, action
        case entityType = "entity_type"
        case requestId = "request_id"
        case createdAt = "created_at"
    }
}

// MARK: - History Models

struct HistoryVersion: Codable, Identifiable {
    let id: String
    var parentVersionId: String?
    var diffSummary: String?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case parentVersionId = "parent_version_id"
        case diffSummary = "diff_summary"
        case createdAt = "created_at"
    }
}

struct RecipeHistoryResponse: Codable {
    let recipeId: String
    let versions: [HistoryVersion]
    let chatMessages: [ChatMessageItem]

    enum CodingKeys: String, CodingKey {
        case recipeId = "recipe_id"
        case versions
        case chatMessages = "chat_messages"
    }
}

// MARK: - Generic Response Wrappers

struct CookbookResponse: Codable {
    let items: [RecipeCard]
    var cookbookInsight: String?

    enum CodingKeys: String, CodingKey {
        case items
        case cookbookInsight = "cookbook_insight"
    }
}

struct ChangelogResponse: Codable {
    let items: [ChangelogItem]
}

struct SaveResponse: Codable {
    let saved: Bool
}

struct OkResponse: Codable {
    let ok: Bool
}

struct AttachmentResponse: Codable {
    let recipe: RecipeView
    let attachmentId: String

    enum CodingKeys: String, CodingKey {
        case recipe
        case attachmentId = "attachment_id"
    }
}
