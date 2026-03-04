import SwiftUI

@Observable
final class CookbookViewModel {
    static let fallbackInsight = "You’ve been putting together a great cookbook."
    static let emptyCookbookInsight = "Start your first recipe on the Generate tab and build your cookbook."

    var recipes: [RecipeCard] = []
    var searchText = ""
    var selectedCategory = "All"
    private var apiCookbookInsight: String?
    var isLoading = false
    var error: String?

    var cookbookInsight: String {
        if recipes.isEmpty {
            return Self.emptyCookbookInsight
        }

        if let apiCookbookInsight {
            return apiCookbookInsight
        }

        if recipes.count == 1 {
            return "Great start. You’ve saved your first recipe."
        }

        return "You’ve saved \(recipes.count) recipes. Keep building your cookbook."
    }

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
            apiCookbookInsight = normalizedInsight(response.cookbookInsight)
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }

    func refresh(api: APIClient) async {
        do {
            let response = try await api.getCookbook()
            recipes = response.items
            apiCookbookInsight = normalizedInsight(response.cookbookInsight)
        } catch {
            self.error = error.localizedDescription
        }
    }

    func refreshAfterCommit(api: APIClient, committedRecipeIds: [String]? = nil) async {
        await refresh(api: api)

        guard let committedRecipeIds, !committedRecipeIds.isEmpty else {
            return
        }

        let committedIdSet = Set(committedRecipeIds)
        let fetchedIdSet = Set(recipes.map(\.id))
        guard !committedIdSet.isSubset(of: fetchedIdSet) else {
            return
        }

        // Commit persistence and cookbook projection can settle asynchronously.
        try? await Task.sleep(for: .milliseconds(300))
        await refresh(api: api)
    }

    private func normalizedInsight(_ candidate: String?) -> String {
        guard let candidate else {
            return Self.fallbackInsight
        }
        let trimmed = candidate.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? Self.fallbackInsight : trimmed
    }
}
