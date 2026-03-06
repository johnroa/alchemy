import Foundation

/// Core recipe model matching the API contract from GET /recipes/{id}.
/// When the API is wired, this will be decoded directly from the JSON response.
struct Recipe: Identifiable, Hashable {
    let id: String
    let title: String
    let summary: String
    let servings: Int
    let category: String
    let ingredients: [Ingredient]
    let steps: [Step]
    let imageURL: URL?
    let imageStatus: ImageStatus
    let updatedAt: Date

    /// Nutrition metadata returned by the API in recipe.metadata
    var nutrition: NutritionInfo?

    /// Quick-reference stats shown in the glass preview modal
    var quickStats: QuickStats?
}

struct Ingredient: Identifiable, Hashable {
    let id: String
    let name: String
    let quantity: String
    let unit: String?

    /// Formatted display string for the quantity column (e.g. "2 tbsp", "1/2 cup")
    var displayQuantity: String {
        if let unit {
            return "\(quantity) \(unit)"
        }
        return quantity
    }
}

struct Step: Identifiable, Hashable {
    let id: String
    let number: Int
    let instruction: String
}

struct NutritionInfo: Hashable {
    let calories: Int
    let protein: Double
    let carbs: Double
    let fat: Double
}

/// Quick stats displayed on the glass preview modal as circular gauges.
/// Values are normalized 0.0–1.0 for gauge rendering.
struct QuickStats: Hashable {
    let timeMinutes: Int
    let difficulty: Double
    let healthScore: Double
    let ingredientCount: Int
}

enum ImageStatus: String, Hashable {
    case pending
    case ready
    case failed
}

/// Lightweight card model for cookbook grid listings.
/// Matches the items[] shape from GET /recipes/cookbook.
struct RecipeCard: Identifiable, Hashable {
    let id: String
    let title: String
    let summary: String
    let category: String
    let imageURL: URL?
    let imageStatus: ImageStatus
    let updatedAt: Date

    // Quick-stat data for explore card gauges (TikTok-style right rail)
    var cookTimeMinutes: Int = 45
    var difficulty: Double = 0.5
    var healthScore: Double = 0.65
    var ingredientCount: Int = 10
}

/// Chat message used across Generate and Onboarding chat interfaces.
struct ChatMessage: Identifiable, Hashable {
    let id: String
    let role: MessageRole
    let content: String
    let createdAt: Date
    /// When true, the bubble shows an animated chef loading phrase
    /// instead of `content`. Set to false once the real reply arrives.
    var isLoading: Bool = false
}

enum MessageRole: String, Hashable {
    case user
    case assistant
}

/// Represents a component in a candidate recipe set during generation.
/// Maps to candidate_recipe_set.components[] from the chat API response.
struct RecipeComponent: Identifiable, Hashable {
    let id: String
    let role: String
    let title: String
    let recipe: Recipe
}
