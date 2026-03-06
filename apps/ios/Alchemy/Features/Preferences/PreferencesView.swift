import SwiftUI

/// User preferences form backed by GET /preferences and PATCH /preferences.
///
/// Nine preference fields organized in sections. Loads current values on
/// appear and sends only changed fields on save. Array fields (dietary,
/// equipment, cuisines, aversions) use comma-separated text inputs that
/// are split/joined for the API.
struct PreferencesView: View {
    @Environment(\.dismiss) private var dismiss

    @State private var profile = PreferenceProfile()
    @State private var isLoading = true
    @State private var isSaving = false
    @State private var errorMessage: String?

    // Local form state — arrays stored as comma-separated strings for editing
    @State private var dietaryPreferencesText = ""
    @State private var dietaryRestrictionsText = ""
    @State private var skillLevel = "Home Cook"
    @State private var equipmentText = ""
    @State private var cuisinesText = ""
    @State private var aversionsText = ""
    @State private var cookingFor = ""
    @State private var maxDifficulty = 0.5
    @State private var freeForm = ""

    /// Maps API skill level values to display labels and back.
    /// API returns lowercase values like "beginner", "intermediate", "advanced".
    private static let skillLevelMap: [(api: String, display: String)] = [
        ("beginner", "Beginner"),
        ("intermediate", "Home Cook"),
        ("advanced", "Experienced"),
        ("professional", "Professional"),
    ]
    private let skillLevels = skillLevelMap.map(\.display)

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    Form {
                        Section("Dietary") {
                            TextField("Preferences (e.g., vegetarian, keto)", text: $dietaryPreferencesText)
                            TextField("Restrictions (e.g., gluten-free, nut allergy)", text: $dietaryRestrictionsText)
                        }

                        Section("Skill & Equipment") {
                            Picker("Skill Level", selection: $skillLevel) {
                                ForEach(skillLevels, id: \.self) { level in
                                    Text(level).tag(level)
                                }
                            }

                            TextField("Equipment (e.g., oven, stand mixer, grill)", text: $equipmentText)
                        }

                        Section("Taste") {
                            TextField("Favorite cuisines", text: $cuisinesText)
                            TextField("Aversions / dislikes", text: $aversionsText)
                        }

                        Section("Household") {
                            TextField("Cooking for (number of people)", text: $cookingFor)
                                .keyboardType(.numberPad)

                            VStack(alignment: .leading) {
                                Text("Max Difficulty: \(difficultyLabel)")
                                Slider(value: $maxDifficulty, in: 0...1)
                                    .tint(AlchemyColors.accent)
                            }
                        }

                        Section("Anything Else") {
                            TextField("Free-form notes for the chef...", text: $freeForm, axis: .vertical)
                                .lineLimit(3...6)
                        }

                        if let errorMessage {
                            Section {
                                Text(errorMessage)
                                    .foregroundStyle(.red)
                                    .font(AlchemyTypography.caption)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Preferences")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Save") {
                        Task { await savePreferences() }
                    }
                    .fontWeight(.semibold)
                    .disabled(isSaving)
                }
            }
            .task {
                await loadPreferences()
            }
        }
    }

    private var difficultyLabel: String {
        maxDifficulty < 0.33 ? "Easy" : maxDifficulty < 0.66 ? "Medium" : "Hard"
    }

    // MARK: - API

    private func loadPreferences() async {
        isLoading = true
        defer { isLoading = false }

        do {
            let p: PreferenceProfile = try await APIClient.shared.request("/preferences")
            profile = p
            populateFormFields(from: p)
        } catch {
            // Surface the error so the user knows something is wrong,
            // rather than silently showing an empty form.
            errorMessage = "Couldn't load your preferences."
            print("[PreferencesView] load failed: \(error)")
        }
    }

    private func savePreferences() async {
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }

        // Convert display skill level back to API value
        let apiSkillLevel = Self.skillLevelMap.first { $0.display == skillLevel }?.api ?? "intermediate"
        // Convert slider 0-1 back to API 1-5 integer scale
        let apiMaxDifficulty = round(maxDifficulty * 4.0) + 1.0

        let updated = PreferenceProfile(
            dietaryPreferences: splitCommaSeparated(dietaryPreferencesText),
            dietaryRestrictions: splitCommaSeparated(dietaryRestrictionsText),
            skillLevel: apiSkillLevel,
            equipment: splitCommaSeparated(equipmentText),
            cuisines: splitCommaSeparated(cuisinesText),
            aversions: splitCommaSeparated(aversionsText),
            cookingFor: cookingFor.isEmpty ? nil : cookingFor,
            maxDifficulty: apiMaxDifficulty,
            freeForm: freeForm.isEmpty ? nil : freeForm
        )

        do {
            let _: PreferenceProfile = try await APIClient.shared.request(
                "/preferences",
                method: .patch,
                body: updated
            )
            dismiss()
        } catch {
            errorMessage = "Failed to save preferences. Please try again."
            print("[PreferencesView] save failed: \(error)")
        }
    }

    // MARK: - Helpers

    private func populateFormFields(from p: PreferenceProfile) {
        dietaryPreferencesText = (p.dietaryPreferences ?? []).joined(separator: ", ")
        dietaryRestrictionsText = (p.dietaryRestrictions ?? []).joined(separator: ", ")

        // Normalize API skill level ("intermediate") to display label ("Home Cook")
        let apiSkill = (p.skillLevel ?? "intermediate").lowercased()
        skillLevel = Self.skillLevelMap.first { $0.api == apiSkill }?.display ?? "Home Cook"

        equipmentText = (p.equipment ?? []).joined(separator: ", ")
        cuisinesText = (p.cuisines ?? []).joined(separator: ", ")
        aversionsText = (p.aversions ?? []).joined(separator: ", ")
        cookingFor = p.cookingFor ?? ""

        // API stores max_difficulty as 1-5 integer scale; slider uses 0-1 normalized.
        let rawDifficulty = p.maxDifficulty ?? 3.0
        maxDifficulty = rawDifficulty <= 1.0 ? rawDifficulty : min(rawDifficulty / 5.0, 1.0)

        freeForm = p.freeForm ?? ""
    }

    /// Splits a comma-separated string into trimmed, non-empty array items.
    private func splitCommaSeparated(_ text: String) -> [String] {
        text.split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }
}
