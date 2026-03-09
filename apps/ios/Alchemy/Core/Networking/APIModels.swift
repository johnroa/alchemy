import Foundation

// MARK: - Cookbook

/// Response from GET /recipes/cookbook.
/// Items are CookbookEntryItem (canonical recipe + variant status),
/// not plain RecipePreview.
struct CookbookResponse: Decodable {
    let items: [CookbookEntryItem]
    let suggestedChips: [SuggestedChip]
    let cookbookInsight: String?
    let staleContext: StaleContext?
}

/// Context for stale recipe variants — which constraint preferences changed
/// and which recipes are affected. Drives the preference-change banner in
/// the Cookbook so the user knows exactly what changed and can act on it.
struct StaleContext: Decodable {
    let changedFields: [String]
    let staleRecipeIds: [String]
    let count: Int

    /// Human-readable labels for the constraint fields that changed.
    var changedFieldLabels: [String] {
        changedFields.compactMap { Self.fieldLabels[$0] }
    }

    /// Formatted summary like "Dietary Restrictions and Aversions".
    var changedFieldsSummary: String {
        let labels = changedFieldLabels
        if labels.isEmpty { return "Preferences" }
        if labels.count == 1 { return labels[0] }
        if labels.count == 2 { return "\(labels[0]) and \(labels[1])" }
        return labels.dropLast().joined(separator: ", ") + ", and " + (labels.last ?? "")
    }

    private static let fieldLabels: [String: String] = [
        "dietary_restrictions": "Dietary Restrictions",
        "aversions": "Ingredients To Avoid",
        "equipment": "Equipment",
        "dietary_preferences": "Dietary Preferences",
        "cuisines": "Cuisines",
    ]
}

struct SuggestedChip: Decodable, Identifiable, Hashable {
    let id: String
    let label: String
    let matchedCount: Int
}

/// Structured tag set computed from a variant's personalized content.
/// Multi-dimensional: cuisine, dietary, technique, occasion, time,
/// difficulty, and key ingredients. Empty when no variant exists.
struct VariantTags: Decodable, Hashable {
    let cuisine: [String]?
    let dietary: [String]?
    let technique: [String]?
    let occasion: [String]?
    let timeMinutes: Int?
    let difficulty: String?
    let keyIngredients: [String]?

    /// True when any tag category is populated.
    var hasAnyTags: Bool {
        (cuisine?.isEmpty == false) ||
        (dietary?.isEmpty == false) ||
        (technique?.isEmpty == false) ||
        (occasion?.isEmpty == false) ||
        (keyIngredients?.isEmpty == false) ||
        timeMinutes != nil ||
        difficulty != nil
    }

    /// All dietary + cuisine tags combined for quick badge display.
    var badgeTags: [String] {
        (dietary ?? []) + (cuisine ?? [])
    }
}

/// A cookbook entry as returned by GET /recipes/cookbook. Includes canonical
/// recipe preview data plus variant status. When a variant exists, summary
/// and tags reflect the personalised version; title always stays canonical.
///
/// The API returns the cookbook entry primary key as `id`, not `cookbook_entry_id`,
/// so we use CodingKeys to map JSON `id` → `cookbookEntryId`. The decoder's
/// `convertFromSnakeCase` strategy still handles all other snake_case keys via
/// their default camelCase raw values.
struct CookbookEntryItem: Decodable, Identifiable, Hashable {
    let cookbookEntryId: String
    let canonicalRecipeId: String?
    let recipeId: String?
    let canonicalStatus: String
    let title: String
    let summary: String
    let imageUrl: String?
    let imageStatus: String
    let category: String?
    let visibility: String
    let updatedAt: String
    let quickStats: RecipeQuickStats?
    let variantStatus: String
    let activeVariantVersionId: String?
    let personalizedAt: String?
    let autopersonalize: Bool
    let savedAt: String
    let variantTags: VariantTags?
    let matchedChipIds: [String]

    private enum CodingKeys: String, CodingKey {
        case cookbookEntryId = "id"
        case canonicalRecipeId, recipeId, canonicalStatus
        case title, summary, imageUrl, imageStatus
        case category, visibility, updatedAt, quickStats
        case variantStatus, activeVariantVersionId, personalizedAt
        case autopersonalize, savedAt, variantTags, matchedChipIds
    }

    /// Identifiable conformance uses the cookbook entry ID.
    var id: String { cookbookEntryId }

    var resolvedImageURL: URL? {
        guard let imageUrl, imageStatus == "ready" else { return nil }
        return URL(string: imageUrl)
    }

    var hasCanonicalRecipe: Bool {
        canonicalRecipeId != nil
    }

    /// Whether the variant is actively personalised (not "none").
    var hasVariant: Bool {
        variantStatus != "none"
    }

    /// Whether the variant needs attention (stale, failed, or needs review).
    var variantNeedsAttention: Bool {
        variantStatus == "stale" || variantStatus == "failed" || variantStatus == "needs_review"
    }

    /// Effective difficulty for filtering — prefers variant tags, falls back to quickStats.
    var effectiveDifficulty: String? {
        variantTags?.difficulty ?? quickStats?.difficulty
    }

    /// Effective time in minutes for filtering — prefers variant tags, falls back to quickStats.
    var effectiveTimeMinutes: Int? {
        variantTags?.timeMinutes ?? quickStats?.timeMinutes
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
    let category: String?
    let visibility: String
    let updatedAt: String
    let quickStats: RecipeQuickStats?
    /// Number of users who saved this recipe. Only present in search/explore responses.
    let saveCount: Int?
    /// Number of personalized variants created across all users.
    let variantCount: Int?
    /// All-time weighted discovery score from the search index.
    let popularityScore: Double?
    /// Recent weighted growth score from the search index.
    let trendingScore: Double?
    /// Short personalized explanation tags for the Explore card.
    let whyTags: [String]?

    /// Derives a URL from the image_url string, returns nil when pending/failed.
    var resolvedImageURL: URL? {
        guard let imageUrl, imageStatus == "ready" else { return nil }
        return URL(string: imageUrl)
    }

    /// Human-readable social proof text, e.g. "42 saves · 12 versions".
    var socialProofText: String? {
        var parts: [String] = []
        if let saveCount, saveCount > 0 {
            parts.append("\(saveCount) \(saveCount == 1 ? "save" : "saves")")
        }
        if let variantCount, variantCount > 0 {
            parts.append("\(variantCount) \(variantCount == 1 ? "version" : "versions")")
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
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
    /// Guards against doubled units: if displayAmount already ends with
    /// the unit (e.g. displayAmount="pinch", unit="pinch" → "pinch",
    /// not "pinch pinch"; displayAmount="1 tsp", unit="tsp" → "1 tsp").
    var displayQuantity: String {
        let numericPart: String = {
            if let displayAmount, !displayAmount.isEmpty {
                return displayAmount
            }
            return amount?.stringValue ?? ""
        }()
        if let unit, !unit.isEmpty,
           !Self.redundantUnits.contains(unit.lowercased()) {
            let alreadyHasUnit = numericPart
                .lowercased()
                .hasSuffix(unit.lowercased())
            if !alreadyHasUnit {
                return "\(numericPart) \(unit)"
            }
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
///
/// Uses a custom decoder for `cuisine` because the LLM and DB both
/// store it as `[String]` (e.g. `["Italian","Mediterranean"]`) but
/// older records or edge cases might produce a bare `"Italian"` string.
struct RecipeMetadata: Decodable {
    let nutrition: RecipeNutrition?
    let quickStats: RecipeQuickStats?
    let cuisine: [String]?
    let difficulty: String?
    let timeMinutes: Int?
    let healthScore: Int?
    let vibe: String?
    let allergens: [String]?
    let dietTags: [String]?
    let techniques: [String]?
    let equipment: [String]?
    let timing: RecipeTiming?

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        nutrition = try container.decodeIfPresent(RecipeNutrition.self, forKey: .nutrition)
        quickStats = try container.decodeIfPresent(RecipeQuickStats.self, forKey: .quickStats)
        difficulty = try container.decodeIfPresent(String.self, forKey: .difficulty)
        timeMinutes = try container.decodeIfPresent(Int.self, forKey: .timeMinutes)
        healthScore = try container.decodeIfPresent(Int.self, forKey: .healthScore)
        vibe = try container.decodeIfPresent(String.self, forKey: .vibe)
        allergens = try container.decodeIfPresent([String].self, forKey: .allergens)
        dietTags = try container.decodeIfPresent([String].self, forKey: .dietTags)
        techniques = try container.decodeIfPresent([String].self, forKey: .techniques)
        equipment = try container.decodeIfPresent([String].self, forKey: .equipment)
        timing = try container.decodeIfPresent(RecipeTiming.self, forKey: .timing)

        // cuisine: accept both ["Italian"] (array) and "Italian" (bare string).
        // The LLM and DB use arrays; bare string is a fallback for robustness.
        if let array = try? container.decode([String].self, forKey: .cuisine) {
            cuisine = array
        } else if let single = try? container.decode(String.self, forKey: .cuisine) {
            cuisine = [single]
        } else {
            cuisine = nil
        }
    }

    private enum CodingKeys: String, CodingKey {
        case nutrition, quickStats, cuisine, difficulty, timeMinutes
        case healthScore, vibe, allergens, dietTags, techniques, equipment, timing
    }
}

/// Timing breakdown from the LLM's recipe metadata.
struct RecipeTiming: Decodable {
    let prepMinutes: Int?
    let cookMinutes: Int?
    let totalMinutes: Int?
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

/// A single ingredient substitution made during personalization.
/// Records what was swapped, why, and which constraint triggered it.
struct SubstitutionDiff: Decodable, Identifiable {
    var id: String { "\(original)::\(replacement)" }
    let original: String
    let replacement: String
    let constraint: String
    let reason: String
}

/// Response from POST /recipes/{id}/variant/refresh.
/// Contains the resulting variant state, substitution diffs, and any conflicts detected.
struct VariantRefreshResponse: Decodable {
    let variantId: String
    let variantVersionId: String
    let variantStatus: String
    let adaptationSummary: String
    /// Structured ingredient substitutions made during personalization.
    let substitutionDiffs: [SubstitutionDiff]?
    /// Manual edits that conflict with current constraints.
    /// Non-empty → variant is in `needs_review` state.
    let conflicts: [String]?
}

/// Response from GET /recipes/{id}/variant — full variant detail
/// including substitution diffs for the "What did my Sous Chef change?" view.
struct VariantDetailResponse: Decodable {
    let variantId: String
    let variantVersionId: String
    let canonicalRecipeId: String
    let recipe: RecipeDetail?
    let adaptationSummary: String?
    let variantStatus: String
    let derivationKind: String?
    let personalizedAt: String?
    /// Structured ingredient substitutions from provenance.
    let substitutionDiffs: [SubstitutionDiff]?
}

/// Response from GET /recipes/cookbook/{entryId} — private-first cookbook detail.
struct CookbookRecipeDetailResponse: Decodable {
    let cookbookEntryId: String
    let canonicalRecipeId: String?
    let canonicalStatus: String
    let variantId: String?
    let variantVersionId: String?
    let recipe: RecipeDetail
    let adaptationSummary: String?
    let variantStatus: String
    let derivationKind: String?
    let personalizedAt: String?
    let substitutionDiffs: [SubstitutionDiff]?
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
    let cookbookEntryId: String
    let recipeId: String?
    let recipeVersionId: String?
    let variantId: String?
    let variantVersionId: String?
    let variantStatus: String
    let canonicalStatus: String
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
    let summary: String?
    let description: String?
    let servings: Int?
    let ingredients: [APIIngredient]?
    let ingredientGroups: [APIIngredientGroup]?
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
    /// When true, the server deferred recipe generation. The client
    /// should show the generation animation and call POST /chat/:id/generate.
    let generationPending: Bool?
}

struct ChatResponseContext: Decodable {
    let mode: String?
    let intent: String?
    let changedSections: [String]?
    let personalizationNotes: [String]?
    /// Preference updates extracted by the Sous Chef during conversation.
    /// Each entry describes a single preference field change that was saved.
    let preferenceUpdates: [PreferenceUpdate]?

    private enum CodingKeys: String, CodingKey {
        case mode, intent, changedSections, personalizationNotes, preferenceUpdates
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        mode = try container.decodeIfPresent(String.self, forKey: .mode)
        intent = try container.decodeIfPresent(String.self, forKey: .intent)
        changedSections = try container.decodeIfPresent([String].self, forKey: .changedSections)
        personalizationNotes = try container.decodeIfPresent([String].self, forKey: .personalizationNotes)

        // The server sends preference_updates as a dict keyed by field name
        // (e.g. {"dietary_preferences": [...]}), not an array of PreferenceUpdate
        // objects. Try the array format first for forward-compat, then fall back
        // to extracting dict keys so the "Updated X" toast still fires. If
        // neither works, set nil — the server already applied the updates.
        if let arr = try? container.decodeIfPresent([PreferenceUpdate].self, forKey: .preferenceUpdates) {
            preferenceUpdates = arr
        } else if container.contains(.preferenceUpdates) {
            let fieldNames = (try? container.decode(
                [String: IgnoredJSON].self, forKey: .preferenceUpdates
            ))?.keys.map { $0 } ?? []
            preferenceUpdates = fieldNames.isEmpty
                ? nil
                : fieldNames.map { PreferenceUpdate(field: $0, value: .null, action: "update") }
        } else {
            preferenceUpdates = nil
        }
    }
}

/// Swallows any JSON value so we can extract dict keys without knowing
/// the value types. Used by ChatResponseContext for preference_updates.
private struct IgnoredJSON: Decodable {
    init(from decoder: Decoder) throws {
        if var unkeyedContainer = try? decoder.unkeyedContainer() {
            while !unkeyedContainer.isAtEnd {
                _ = try? unkeyedContainer.decode(IgnoredJSON.self)
            }
        } else if let keyedContainer = try? decoder.container(keyedBy: FlexKey.self) {
            for key in keyedContainer.allKeys {
                _ = try? keyedContainer.decode(IgnoredJSON.self, forKey: key)
            }
        }
        // Scalars and nulls are consumed by the container creation itself
    }

    private struct FlexKey: CodingKey {
        var stringValue: String
        var intValue: Int?
        init?(stringValue: String) { self.stringValue = stringValue; self.intValue = nil }
        init?(intValue: Int) { self.stringValue = "\(intValue)"; self.intValue = intValue }
    }
}

/// A single preference field change surfaced in response_context.
/// Used to synthesize inline "Preferences Saved!" system messages.
struct PreferenceUpdate: Decodable {
    let field: String
    let value: AnyCodableValue
    let action: String?

    init(field: String, value: AnyCodableValue, action: String?) {
        self.field = field
        self.value = value
        self.action = action
    }

    /// Human-readable label for the preference field, matching the
    /// titles shown on the Preferences screen cards.
    var displayName: String {
        Self.fieldDisplayNames[field]
            ?? field.replacingOccurrences(of: "_", with: " ").capitalized
    }

    private static let fieldDisplayNames: [String: String] = [
        "dietary_restrictions": "Dietary Restrictions",
        "dietary_preferences": "Dietary Preferences",
        "equipment": "Equipment & Kitchen Setup",
        "aversions": "Ingredients To Avoid",
        "cuisines": "Favorite Cuisines",
        "pantry_staples": "Pantry Staples",
        "health_goals": "Health Goals",
        "spice_tolerance": "Spice Tolerance",
        "cooking_style": "Cooking Habits",
        "household_detail": "Household & Dining",
        "skill_level": "Skill Level",
        "cooking_for": "Cooking For",
        "max_difficulty": "Max Difficulty",
        "free_form": "Additional Notes",
    ]
}

/// Request body for POST /chat (new session) and POST /chat/{id}/messages
/// `launchContext` is only sent when a surface like Preferences wants a fresh,
/// purpose-built chat loop instead of reusing the generic recipe ideation flow.
/// That gives the backend enough context to keep follow-up questions focused on
/// a single preference category without polluting the main Sous Chef thread.
enum PreferencePropagation: String, Codable, Hashable {
    case retroactive
    case forwardOnly = "forward_only"
    case none
}

struct PreferenceEditingIntent: Codable, Hashable, Identifiable {
    var id: String { key }
    let key: String
    let title: String
    let prompt: String
    let summary: String
    let propagation: PreferencePropagation
    let systemImage: String
}

struct ChatLaunchContext: Encodable {
    let workflow: String?
    let entrySurface: String?
    let preferenceEditingIntent: PreferenceEditingIntent?
}

struct ChatMessageRequest: Encodable {
    let message: String
    let launchContext: ChatLaunchContext?

    init(message: String, launchContext: ChatLaunchContext? = nil) {
        self.message = message
        self.launchContext = launchContext
    }
}

/// Request body for POST /chat/import.
/// Discriminated by `kind`: exactly one of url/text/photoAssetRef must be set.
/// Response is a ChatSessionResponse with a seeded CandidateRecipeSet.
struct ImportRequest: Encodable {
    let kind: String
    let url: String?
    let text: String?
    let photoAssetRef: String?
    let origin: String?

    static func url(_ url: String, origin: String = "in_app_paste") -> ImportRequest {
        ImportRequest(kind: "url", url: url, text: nil, photoAssetRef: nil, origin: origin)
    }

    static func text(_ text: String, origin: String = "in_app_paste") -> ImportRequest {
        ImportRequest(kind: "text", url: nil, text: text, photoAssetRef: nil, origin: origin)
    }

    static func photo(ref: String, origin: String = "in_app_paste") -> ImportRequest {
        ImportRequest(kind: "photo", url: nil, text: nil, photoAssetRef: ref, origin: origin)
    }
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

/// A single category inside the `extended_preferences` JSONB column.
/// Each key (e.g. "spice_tolerance") maps to an array of freeform values
/// and a propagation mode ("constraint" = retroactive, "preference" = forward-only).
struct ExtendedPreferenceEntry: Codable {
    var values: [String]
    var propagation: String?
}

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

    /// Structured JSONB for preference categories beyond the typed columns.
    /// Keyed by category slug (e.g. "spice_tolerance", "health_goals").
    var extendedPreferences: [String: ExtendedPreferenceEntry]?

    /// Rendering-only recipe presentation settings. These should never change
    /// the underlying recipe, only how Alchemy formats the recipe for this user.
    var presentationPreferences: [String: AnyCodableValue]?
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

/// Request body for POST /recipes/search for explicit typed recipe search.
struct RecipeSearchRequest: Encodable {
    let query: String?
    let presetId: String?
    let cursor: String?
    let limit: Int?
    /// Legacy sort hint retained for backward compatibility on explicit search flows.
    let sortBy: String?
}

/// Request body for POST /recipes/explore/for-you.
struct ForYouFeedRequest: Encodable {
    let cursor: String?
    let limit: Int?
    let presetId: String?
    let chipId: String?
}

/// Response from POST /recipes/search
struct RecipeSearchResponse: Decodable {
    let searchId: String
    let appliedContext: String
    let items: [RecipePreview]
    let nextCursor: String?
    let noMatch: RecipeSearchNoMatch?
}

/// Response from POST /recipes/explore/for-you.
struct ForYouFeedResponse: Decodable {
    let feedId: String
    let appliedContext: String
    let profileState: String
    let algorithmVersion: String
    let items: [RecipePreview]
    let suggestedChips: [SuggestedChip]
    let nextCursor: String?
    let noMatch: RecipeSearchNoMatch?
}

struct RecipeSearchNoMatch: Decodable {
    let code: String
    let message: String
    let suggestedAction: String?
}

// MARK: - Ingredient Trending

/// Response from GET /ingredients/trending
struct IngredientTrendingResponse: Decodable {
    let items: [IngredientTrendingStat]
}

/// A single ingredient's popularity and substitution momentum stats.
struct IngredientTrendingStat: Decodable, Identifiable {
    let ingredientId: String
    let canonicalName: String
    let recipeCount: Int
    let trendingRecipeCount: Int
    let popularityScore: Double
    let trendingScore: Double
    let subInCount: Int
    let subOutCount: Int
    /// Scaled -100 to +100. Positive = rising ingredient.
    let momentumScore: Double
    let updatedAt: String

    var id: String { ingredientId }

    /// True when this ingredient has meaningful substitution activity.
    var hasSubstitutionActivity: Bool {
        subInCount > 0 || subOutCount > 0
    }

    /// Direction indicator for the momentum badge.
    var momentumDirection: String {
        if momentumScore > 10 { return "rising" }
        if momentumScore < -10 { return "declining" }
        return "stable"
    }
}

// MARK: - Telemetry

struct BehaviorTelemetryEventRequest: Encodable {
    let eventId: String
    let eventType: String
    let surface: String
    let occurredAt: String
    let sessionId: String?
    let entityType: String?
    let entityId: String?
    let sourceSurface: String?
    let algorithmVersion: String?
    let payload: [String: AnyCodableValue]?
}

struct BehaviorTelemetryBatchRequest: Encodable {
    let installId: String
    let events: [BehaviorTelemetryEventRequest]
}

struct BehaviorTelemetryBatchResponse: Decodable {
    let accepted: Int
    let rejected: Int
}

struct InstallTelemetryEventRequest: Encodable {
    let eventId: String
    let eventType: String
    let occurredAt: String
    let payload: [String: AnyCodableValue]?
}

struct InstallTelemetryBatchRequest: Encodable {
    let installId: String
    let events: [InstallTelemetryEventRequest]
}

struct SaveRecipeRequest: Encodable {
    let autopersonalize: Bool?
    let sourceSurface: String?
    let sourceSessionId: String?
    let algorithmVersion: String?
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
enum AnyCodableValue: Codable, Hashable {
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

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value):
            try container.encode(value)
        case .int(let value):
            try container.encode(value)
        case .double(let value):
            try container.encode(value)
        case .bool(let value):
            try container.encode(value)
        case .null:
            try container.encodeNil()
        }
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

    var boolValue: Bool? {
        switch self {
        case .bool(let value): return value
        case .string(let value):
            switch value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
            case "true", "yes", "1", "on": return true
            case "false", "no", "0", "off": return false
            default: return nil
            }
        case .int(let value):
            return value != 0
        case .double(let value):
            return value != 0
        case .null:
            return nil
        }
    }
}
