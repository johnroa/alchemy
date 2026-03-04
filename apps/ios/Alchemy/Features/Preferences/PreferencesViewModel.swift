import SwiftUI

@Observable
final class PreferencesViewModel {
    static let fallbackInsight = "You’ve been putting together a great cookbook."
    private enum RawPreferenceKeys {
        static let dietaryPreferences = "raw_dietary_preferences"
        static let dietaryRestrictions = "raw_dietary_restrictions"
        static let equipment = "raw_special_equipment"
        static let cuisines = "raw_cuisines"
        static let aversions = "raw_disliked_ingredients"
    }
    enum Limits {
        static let aboutYou = 600
        static let cookingFor = 180
        static let equipment = 280
        static let dietaryPreferences = 220
        static let dietaryRestrictions = 220
        static let skillLevel = 80
        static let cuisines = 220
        static let aversions = 220
    }

    var freeForm = "" {
        didSet {
            if freeForm.count > Limits.aboutYou {
                freeForm = String(freeForm.prefix(Limits.aboutYou))
            }
        }
    }
    var equipment = "" {
        didSet {
            if equipment.count > Limits.equipment {
                equipment = String(equipment.prefix(Limits.equipment))
            }
        }
    }
    var dietaryPreferences = "" {
        didSet {
            if dietaryPreferences.count > Limits.dietaryPreferences {
                dietaryPreferences = String(dietaryPreferences.prefix(Limits.dietaryPreferences))
            }
        }
    }
    var dietaryRestrictions = "" {
        didSet {
            if dietaryRestrictions.count > Limits.dietaryRestrictions {
                dietaryRestrictions = String(dietaryRestrictions.prefix(Limits.dietaryRestrictions))
            }
        }
    }
    var skillLevel = "" {
        didSet {
            if skillLevel.count > Limits.skillLevel {
                skillLevel = String(skillLevel.prefix(Limits.skillLevel))
            }
        }
    }
    var cuisines = "" {
        didSet {
            if cuisines.count > Limits.cuisines {
                cuisines = String(cuisines.prefix(Limits.cuisines))
            }
        }
    }
    var aversions = "" {
        didSet {
            if aversions.count > Limits.aversions {
                aversions = String(aversions.prefix(Limits.aversions))
            }
        }
    }
    var cookingFor = "" {
        didSet {
            if cookingFor.count > Limits.cookingFor {
                cookingFor = String(cookingFor.prefix(Limits.cookingFor))
            }
        }
    }
    var maxDifficulty: Double = 3
    var recipeUnits: RecipeUnits = .source
    var recipeGroupBy: RecipeGroupBy = .flat
    var inlineMeasurements = true

    var cookbookInsight = PreferencesViewModel.fallbackInsight
    private var presentationPreferences: [String: JSONValue] = [:]

    var isLoading = false
    var isSaving = false
    var error: String?
    var hasLoaded = false

    private var signalStatus: [(title: String, value: String)] {
        [
            ("about you", freeForm),
            ("equipment", equipment),
            ("dietary preferences", dietaryPreferences),
            ("dietary restrictions", dietaryRestrictions),
            ("skill level", skillLevel),
            ("cuisines", cuisines),
            ("aversions", aversions),
            ("cooking for", cookingFor)
        ]
    }

    var completionRatio: Double {
        guard !signalStatus.isEmpty else { return 0 }
        return Double(completedSignalCount) / Double(signalStatus.count)
    }

    var completionText: String {
        "\(Int((completionRatio * 100).rounded()))% complete"
    }

    var missingSignals: [String] {
        signalStatus
            .filter { $0.value.trimmed.isEmpty }
            .map(\.title)
    }

    var smartHeadline: String {
        switch completionRatio {
        case 0.85...:
            return "Your profile is highly tuned."
        case 0.5..<0.85:
            return "You’re halfway to better personalization."
        default:
            return "Add a few details to improve recipe quality."
        }
    }

    var smartDetail: String {
        if missingSignals.isEmpty {
            return cookbookInsight
        }

        let nextSignals = missingSignals.prefix(2).joined(separator: " and ")
        return "Next best update: add \(nextSignals). \(cookbookInsight)"
    }

    func load(api: APIClient) async {
        isLoading = true
        error = nil
        defer { isLoading = false }

        do {
            let profile = try await api.getPreferences()
            let cookbookResponse = try? await api.getCookbook()

            apply(profile: profile)
            cookbookInsight = normalizedInsight(cookbookResponse?.cookbookInsight)
            hasLoaded = true
        } catch {
            self.error = error.localizedDescription
        }
    }

    func save(api: APIClient) async {
        isSaving = true
        error = nil
        defer { isSaving = false }

        let profile = PreferenceProfile(
            freeForm: freeForm.isEmpty ? nil : freeForm,
            dietaryPreferences: listPayload(dietaryPreferences),
            dietaryRestrictions: listPayload(dietaryRestrictions),
            skillLevel: skillLevel.isEmpty ? "intermediate" : skillLevel,
            equipment: listPayload(equipment),
            cuisines: listPayload(cuisines),
            aversions: listPayload(aversions),
            cookingFor: cookingFor.isEmpty ? nil : cookingFor,
            maxDifficulty: Int(maxDifficulty),
            presentationPreferences: mergedPresentationPreferences()
        )

        do {
            let updatedProfile = try await api.updatePreferences(profile)
            apply(profile: updatedProfile)
            Haptics.fire(.success)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func listPayload(_ value: String) -> [String] {
        let trimmed = value.trimmed
        return trimmed.isEmpty ? [] : [trimmed]
    }

    private var completedSignalCount: Int {
        signalStatus.reduce(into: 0) { count, item in
            if !item.value.trimmed.isEmpty {
                count += 1
            }
        }
    }

    private func apply(profile: PreferenceProfile) {
        presentationPreferences = profile.presentationPreferences ?? [:]
        let projection = profile.recipeProjection
        freeForm = profile.freeForm ?? ""
        equipment = rawValue(for: RawPreferenceKeys.equipment) ?? profile.equipment.joined(separator: ", ")
        dietaryPreferences = rawValue(for: RawPreferenceKeys.dietaryPreferences) ?? profile.dietaryPreferences.joined(separator: ", ")
        dietaryRestrictions = rawValue(for: RawPreferenceKeys.dietaryRestrictions) ?? profile.dietaryRestrictions.joined(separator: ", ")
        skillLevel = profile.skillLevel
        cuisines = rawValue(for: RawPreferenceKeys.cuisines) ?? profile.cuisines.joined(separator: ", ")
        aversions = rawValue(for: RawPreferenceKeys.aversions) ?? profile.aversions.joined(separator: ", ")
        cookingFor = profile.cookingFor ?? ""
        maxDifficulty = Double(profile.maxDifficulty)
        recipeUnits = projection.units
        recipeGroupBy = projection.groupBy
        inlineMeasurements = projection.inlineMeasurements
    }

    private func rawValue(for key: String) -> String? {
        guard case .string(let value)? = presentationPreferences[key] else {
            return nil
        }
        let trimmed = value.trimmed
        return trimmed.isEmpty ? nil : trimmed
    }

    private func mergedPresentationPreferences() -> [String: JSONValue]? {
        var merged = presentationPreferences

        setRawPreference(in: &merged, key: RawPreferenceKeys.dietaryPreferences, value: dietaryPreferences)
        setRawPreference(in: &merged, key: RawPreferenceKeys.dietaryRestrictions, value: dietaryRestrictions)
        setRawPreference(in: &merged, key: RawPreferenceKeys.equipment, value: equipment)
        setRawPreference(in: &merged, key: RawPreferenceKeys.cuisines, value: cuisines)
        setRawPreference(in: &merged, key: RawPreferenceKeys.aversions, value: aversions)
        merged[PresentationPreferenceKey.recipeUnits] = .string(recipeUnits.rawValue)
        merged[PresentationPreferenceKey.recipeGroupBy] = .string(recipeGroupBy.rawValue)
        merged[PresentationPreferenceKey.recipeInlineMeasurements] = .bool(inlineMeasurements)

        return merged.isEmpty ? nil : merged
    }

    private func setRawPreference(in preferences: inout [String: JSONValue], key: String, value: String) {
        let trimmed = value.trimmed
        if trimmed.isEmpty {
            preferences.removeValue(forKey: key)
        } else {
            preferences[key] = .string(trimmed)
        }
    }

    private func normalizedInsight(_ candidate: String?) -> String {
        guard let candidate else {
            return Self.fallbackInsight
        }
        let trimmed = candidate.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? Self.fallbackInsight : trimmed
    }
}

private extension String {
    var trimmed: String {
        trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
