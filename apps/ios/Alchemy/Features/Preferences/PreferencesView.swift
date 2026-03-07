import SwiftUI

/// Preferences screen with iOS 26 Liquid Glass design.
///
/// Hard visual split between two tiers:
///
/// 1. **You Control** — directly editable fields (skill level, household
///    description, max difficulty). Saved via PATCH /preferences.
///    Uses interactive native controls (Picker, TextField, Slider).
///
/// 2. **Sous Chef Profile** — read-only categories managed through
///    conversation. Visually distinct: locked rows with a sparkles
///    accent, explanatory banner at the top, and a CTA to jump to
///    the Sous Chef tab. Tapping any row navigates to the Sous Chef.
///
/// Uses native `Form` with `.scrollContentBackground(.hidden)` for
/// iOS 26 Liquid Glass translucency.
struct PreferencesView: View {
    @Environment(\.dismiss) private var dismiss

    /// Bound to TabShell's selectedTab so the "Chat with Sous Chef" CTA
    /// can switch tabs programmatically after dismissing.
    var selectedTab: Binding<AppTab>?

    @State private var profile = PreferenceProfile()
    @State private var isLoading = true
    @State private var isSaving = false
    @State private var errorMessage: String?

    // Quick Settings form state — synced from profile on load
    @State private var skillLevel = "Home Cook"
    @State private var cookingFor = ""
    @State private var maxDifficulty = 0.5

    /// Maps API skill level values to display labels.
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
                    preferencesForm
                }
            }
            .navigationTitle("Preferences")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView()
                    } else {
                        Button("Save") {
                            Task { await saveQuickSettings() }
                        }
                    }
                }
            }
            .task { await loadPreferences() }
        }
        .tint(.white)
    }

    // MARK: - Form

    private var preferencesForm: some View {
        Form {
            // ── Tier 1: User-editable ──
            quickSettingsSection

            // ── Tier 2: Sous Chef managed ──
            sousChefBanner
            dietAndRestrictionsSection
            kitchenAndEquipmentSection
            tasteAndStyleSection
            cookingHabitsSection
            notesSection
            sousChefCTA
        }
        .scrollContentBackground(.hidden)
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // MARK: - Tier 1: Quick Settings (editable)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    private var quickSettingsSection: some View {
        Section {
            Picker("Skill Level", selection: $skillLevel) {
                ForEach(skillLevels, id: \.self) { Text($0) }
            }

            HStack {
                Text("Cooking For")
                Spacer()
                TextField("e.g. 2, or \"family of 4\"", text: $cookingFor)
                    .multilineTextAlignment(.trailing)
                    .foregroundStyle(.primary)
                    .frame(maxWidth: 180)
            }

            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Max Difficulty")
                    Spacer()
                    Text(difficultyLabel)
                        .foregroundStyle(.secondary)
                }
                Slider(value: $maxDifficulty, in: 0...1, step: 0.25)
            }

            if let errorMessage {
                Text(errorMessage)
                    .foregroundStyle(.red)
                    .font(.caption)
            }
        } header: {
            Label("You Control", systemImage: "pencil.circle")
        } footer: {
            Text("Edit these directly and tap Save.")
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // MARK: - Tier 2: Sous Chef Profile (read-only)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /// Explanatory banner between the two tiers so the user understands
    /// why the rows below look different and can't be tapped to edit.
    private var sousChefBanner: some View {
        Section {
            HStack(spacing: 12) {
                Image(systemName: "sparkles")
                    .font(.title2)
                    .foregroundStyle(.white.opacity(0.9))
                    .frame(width: 36, height: 36)

                VStack(alignment: .leading, spacing: 2) {
                    Text("Sous Chef Profile")
                        .font(.subheadline.weight(.semibold))
                    Text("These preferences are learned and managed through conversation with your Sous Chef.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .listRowBackground(Color.white.opacity(0.06))
        }
    }

    private var dietAndRestrictionsSection: some View {
        Section {
            sousChefRow("Dietary Preferences", values: profile.dietaryPreferences, icon: "heart")
            sousChefRow("Dietary Restrictions", values: profile.dietaryRestrictions, icon: "exclamationmark.triangle")
            sousChefRow("Health Goals", values: extendedValues("health_goals"), icon: "figure.run")
            sousChefRow("Religious / Cultural", values: extendedValues("religious_rules"), icon: "building.columns")
        } header: {
            sousChefSectionHeader("Diet & Restrictions", systemImage: "leaf")
        }
    }

    private var kitchenAndEquipmentSection: some View {
        Section {
            sousChefRow("Equipment", values: profile.equipment, icon: "frying.pan")
            sousChefRow("Kitchen Setup", values: extendedValues("kitchen_environment"), icon: "house")
            sousChefRow("Pantry Staples", values: extendedValues("pantry_staples"), icon: "bag")
        } header: {
            sousChefSectionHeader("Kitchen & Equipment", systemImage: "refrigerator")
        }
    }

    private var tasteAndStyleSection: some View {
        Section {
            sousChefRow("Favorite Cuisines", values: profile.cuisines, icon: "globe")
            sousChefRow("Aversions", values: profile.aversions, icon: "hand.thumbsdown")
            sousChefRow("Spice Tolerance", values: extendedValues("spice_tolerance"), icon: "flame")
            sousChefRow("Flavor Affinities", values: extendedValues("flavor_affinities"), icon: "sparkle")
        } header: {
            sousChefSectionHeader("Taste & Style", systemImage: "fork.knife")
        }
    }

    private var cookingHabitsSection: some View {
        Section {
            sousChefRow("Cooking Style", values: extendedValues("cooking_style"), icon: "clock")
            sousChefRow("Time Budget", values: extendedValues("time_budget"), icon: "timer")
            sousChefRow("Budget", values: extendedValues("budget"), icon: "dollarsign.circle")
            sousChefRow("Household", values: extendedValues("household_detail"), icon: "person.2")
        } header: {
            sousChefSectionHeader("Cooking Habits", systemImage: "calendar")
        }
    }

    /// Only renders when the Sous Chef has stored free-form notes.
    @ViewBuilder
    private var notesSection: some View {
        if let freeForm = profile.freeForm, !freeForm.isEmpty {
            Section {
                Text(freeForm)
                    .font(.callout)
                    .foregroundStyle(.secondary)
            } header: {
                sousChefSectionHeader("Notes", systemImage: "note.text")
            }
        }
    }

    /// CTA button to jump to the Sous Chef tab.
    private var sousChefCTA: some View {
        Section {
            Button {
                dismiss()
                if let selectedTab {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                        selectedTab.wrappedValue = .sousChef
                    }
                }
            } label: {
                HStack {
                    Spacer()
                    Label("Chat with Sous Chef", systemImage: "sparkles")
                        .font(.body.weight(.medium))
                    Spacer()
                }
            }
        } footer: {
            Text("Tell your Sous Chef about dietary needs, equipment, cuisines you love, or anything else — it will remember.")
        }
    }

    // MARK: - Row Helpers

    /// Section header for Sous Chef–managed sections. Includes a small
    /// sparkles indicator to visually distinguish from the editable tier.
    private func sousChefSectionHeader(_ title: String, systemImage: String) -> some View {
        HStack(spacing: 4) {
            Label(title, systemImage: systemImage)
            Image(systemName: "sparkles")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    /// Read-only row for Sous Chef–managed preferences. Tapping
    /// navigates to the Sous Chef so the user can discuss changes.
    /// Visually uses a dimmer value color and a chevron to hint
    /// that tapping opens the Sous Chef (not inline editing).
    private func sousChefRow(_ title: String, values: [String]?, icon: String) -> some View {
        Button {
            dismiss()
            if let selectedTab {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                    selectedTab.wrappedValue = .sousChef
                }
            }
        } label: {
            HStack(alignment: .top) {
                Label(title, systemImage: icon)
                    .foregroundStyle(.primary)
                Spacer()
                if let values, !values.isEmpty {
                    Text(values.joined(separator: ", "))
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.trailing)
                        .lineLimit(2)
                } else {
                    Text("Not set")
                        .foregroundStyle(.tertiary)
                        .italic()
                }
            }
        }
    }

    /// Extracts values from the extended_preferences JSONB blob.
    private func extendedValues(_ key: String) -> [String]? {
        guard let entry = profile.extendedPreferences?[key],
              !entry.values.isEmpty else {
            return nil
        }
        return entry.values
    }

    private var difficultyLabel: String {
        switch maxDifficulty {
        case ..<0.2: "Easy"
        case ..<0.4: "Medium"
        case ..<0.6: "Moderate"
        case ..<0.8: "Hard"
        default: "Expert"
        }
    }

    // MARK: - API

    private func loadPreferences() async {
        isLoading = true
        defer { isLoading = false }

        do {
            let p: PreferenceProfile = try await APIClient.shared.request("/preferences")
            profile = p
            populateQuickSettings(from: p)
        } catch {
            errorMessage = "Couldn't load preferences."
            print("[PreferencesView] load failed: \(error)")
        }
    }

    /// Saves only the Quick Settings fields (skill, household, difficulty).
    /// Sous Chef Profile fields are read-only here — changed via chat.
    private func saveQuickSettings() async {
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }

        let apiSkillLevel = Self.skillLevelMap.first { $0.display == skillLevel }?.api ?? "intermediate"
        let apiMaxDifficulty = round(maxDifficulty * 4.0) + 1.0

        let updated = PreferenceProfile(
            skillLevel: apiSkillLevel,
            cookingFor: cookingFor.isEmpty ? nil : cookingFor,
            maxDifficulty: apiMaxDifficulty
        )

        do {
            let _: PreferenceProfile = try await APIClient.shared.request(
                "/preferences",
                method: .patch,
                body: updated
            )
            dismiss()
        } catch {
            errorMessage = "Failed to save. Please try again."
            print("[PreferencesView] save failed: \(error)")
        }
    }

    private func populateQuickSettings(from p: PreferenceProfile) {
        let apiSkill = (p.skillLevel ?? "intermediate").lowercased()
        skillLevel = Self.skillLevelMap.first { $0.api == apiSkill }?.display ?? "Home Cook"
        cookingFor = p.cookingFor ?? ""

        let rawDifficulty = p.maxDifficulty ?? 3.0
        maxDifficulty = rawDifficulty <= 1.0 ? rawDifficulty : min(rawDifficulty / 5.0, 1.0)
    }
}
