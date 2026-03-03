import SwiftUI

@Observable
final class ExploreViewModel {
    var recipes: [RecipeCard] = []
    var isLoading = false
    var error: String?
    var currentIndex = 0

    func load(api: APIClient) async {
        isLoading = true
        error = nil

        do {
            let response = try await api.getCookbook()
            recipes = response.items
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }

    func refresh(api: APIClient) async {
        do {
            let response = try await api.getCookbook()
            recipes = response.items
        } catch {
            // Silent refresh fail
        }
    }
}
