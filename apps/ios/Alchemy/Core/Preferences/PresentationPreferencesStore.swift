import Foundation
import Observation

@Observable
@MainActor
final class PresentationPreferencesStore {
    private(set) var hasLoaded = false
    var ingredientGrouping = IngredientGroupingMode.defaultMode.rawValue

    func loadIfNeeded() async {
        guard !hasLoaded else { return }
        await refresh()
    }

    func refresh() async {
        do {
            let profile: PreferenceProfile = try await APIClient.shared.request("/preferences")
            apply(profile)
        } catch {
            print("[PresentationPreferencesStore] load failed: \(error)")
        }
    }

    func apply(_ profile: PreferenceProfile) {
        apply(profile.presentationPreferences)
    }

    func apply(_ presentationPreferences: [String: AnyCodableValue]?) {
        ingredientGrouping = IngredientGroupingMode(
            rawPreference: presentationPreferences?["recipe_group_by"]?.stringValue
        ).rawValue
        hasLoaded = true
    }
}
