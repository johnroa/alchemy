import SwiftUI

@Observable
final class RecipeDetailViewModel {
    var recipe: RecipeView?
    var history: RecipeHistoryResponse?
    var isLoading = false
    var error: String?

    func load(recipeId: String, api: APIClient) async {
        isLoading = true
        error = nil

        do {
            let projection = (try? await api.getPreferences().recipeProjection) ?? .fallback
            async let recipeTask = api.getRecipe(recipeId, projection: projection)
            async let historyTask = api.getRecipeHistory(recipeId)

            recipe = try await recipeTask
            history = try await historyTask
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }

    func saveRecipe(api: APIClient) async {
        guard let id = recipe?.id else { return }
        do {
            _ = try await api.saveRecipe(id: id)
            Haptics.fire(.success)
        } catch {
            // Silent fail — cookbook refresh will show truth
        }
    }
}
