import SwiftUI

@Observable
final class PreferencesViewModel {
    var freeForm = ""
    var equipment = ""
    var dietaryPreferences = ""
    var dietaryRestrictions = ""
    var skillLevel = ""
    var cuisines = ""
    var aversions = ""
    var cookingFor = ""
    var maxDifficulty: Double = 3

    var isLoading = false
    var isSaving = false
    var error: String?
    var hasLoaded = false

    func load(api: APIClient) async {
        isLoading = true
        error = nil

        do {
            let profile = try await api.getPreferences()
            freeForm = profile.freeForm ?? ""
            equipment = profile.equipment.joined(separator: ", ")
            dietaryPreferences = profile.dietaryPreferences.joined(separator: ", ")
            dietaryRestrictions = profile.dietaryRestrictions.joined(separator: ", ")
            skillLevel = profile.skillLevel
            cuisines = profile.cuisines.joined(separator: ", ")
            aversions = profile.aversions.joined(separator: ", ")
            cookingFor = profile.cookingFor ?? ""
            maxDifficulty = Double(profile.maxDifficulty)
            hasLoaded = true
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }

    func save(api: APIClient) async {
        isSaving = true
        error = nil

        let profile = PreferenceProfile(
            freeForm: freeForm.isEmpty ? nil : freeForm,
            dietaryPreferences: splitComma(dietaryPreferences),
            dietaryRestrictions: splitComma(dietaryRestrictions),
            skillLevel: skillLevel.isEmpty ? "intermediate" : skillLevel,
            equipment: splitComma(equipment),
            cuisines: splitComma(cuisines),
            aversions: splitComma(aversions),
            cookingFor: cookingFor.isEmpty ? nil : cookingFor,
            maxDifficulty: Int(maxDifficulty)
        )

        do {
            _ = try await api.updatePreferences(profile)
            Haptics.fire(.success)
        } catch {
            self.error = error.localizedDescription
        }

        isSaving = false
    }

    private func splitComma(_ value: String) -> [String] {
        value.split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }
}
