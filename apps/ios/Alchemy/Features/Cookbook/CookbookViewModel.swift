import SwiftUI

@Observable
final class CookbookViewModel {
    var recipes: [RecipeCard] = []
    var searchText = ""
    var selectedCategory = "All"
    var isLoading = false
    var error: String?

    var categories: [String] {
        var cats = Set(recipes.compactMap(\.category))
        cats.insert("All")
        return ["All"] + cats.sorted().filter { $0 != "All" }
    }

    var filteredRecipes: [RecipeCard] {
        var result = recipes

        if selectedCategory != "All" {
            result = result.filter { $0.category == selectedCategory }
        }

        if !searchText.isEmpty {
            let query = searchText.lowercased()
            result = result.filter {
                $0.title.lowercased().contains(query)
                || $0.summary.lowercased().contains(query)
            }
        }

        return result
    }

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
            self.error = error.localizedDescription
        }
    }
}
