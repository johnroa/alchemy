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

// MARK: - Chat Recipe (LLM-generated, pre-save)

/// A recipe returned during chat — not yet persisted, so it lacks DB fields like `id`, `visibility`, `updated_at`.
struct ChatRecipe: Codable {
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
    var asRecipeView: RecipeView {
        RecipeView(
            id: "draft",
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
            updatedAt: "",
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

struct ChatResponse: Codable, Identifiable {
    let id: String
    var activeRecipe: ChatRecipe?
    var assistantReply: AssistantReply?
    var memoryContextIds: [String]?

    enum CodingKeys: String, CodingKey {
        case id
        case activeRecipe = "active_recipe"
        case assistantReply = "assistant_reply"
        case memoryContextIds = "memory_context_ids"
    }
}

struct GenerateResponse: Codable {
    let recipe: RecipeView
    var assistantReply: AssistantReply?

    enum CodingKeys: String, CodingKey {
        case recipe
        case assistantReply = "assistant_reply"
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

// FinalizeResponse removed — use GenerateResponse from chat flow

struct TweakResponse: Codable {
    let recipe: RecipeView
    var assistantReply: AssistantReply?

    enum CodingKeys: String, CodingKey {
        case recipe
        case assistantReply = "assistant_reply"
    }
}

struct AttachmentResponse: Codable {
    let recipe: RecipeView
    let attachmentId: String

    enum CodingKeys: String, CodingKey {
        case recipe
        case attachmentId = "attachment_id"
    }
}
