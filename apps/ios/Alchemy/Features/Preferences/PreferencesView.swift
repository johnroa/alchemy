import SwiftUI

/// Two-tier preferences screen:
///
/// 1. **Quick Settings** — directly editable fields for simple preferences
///    (skill level, household size, max difficulty). Saved via PATCH /preferences.
/// 2. **Sous Chef Profile** — read-only view of complex, nuanced preferences
///    that are managed through conversation (dietary, equipment, cuisines,
///    aversions, free-form notes). Includes a CTA to open the Sous Chef tab.
///
/// This design reflects the philosophy that simple preferences are best edited
/// directly, while complex culinary preferences benefit from the Sous Chef's
/// guided conversational approach.
struct PreferencesView: View {
    @Environment(\.dismiss) private var dismiss
    /// Bound to TabShell's selectedTab so the "Chat with Sous Chef" CTA
    /// can switch tabs programmatically after dismissing. Nil when the
    /// view is presented without tab context (e.g., previews).
    var selectedTab: Binding<AppTab>?

    @State private var profile = PreferenceProfile()
    @State private var isLoading = true
    @State private var isSaving = false
    @State private var errorMessage: String?

    // Quick Settings form state
    @State private var skillLevel = "Home Cook"
    @State private var cookingFor = ""
    @State private var maxDifficulty = 0.5

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
                    ScrollView {
                        VStack(spacing: AlchemySpacing.xl) {
                            quickSettingsSection
                            sousChefProfileSection
                        }
                        .padding(.horizontal, AlchemySpacing.lg)
                        .padding(.vertical, AlchemySpacing.xl)
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
                        Task { await saveQuickSettings() }
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

    // MARK: - Quick Settings

    private var quickSettingsSection: some View {
        VStack(alignment: .leading, spacing: AlchemySpacing.md) {
            Label("Quick Settings", systemImage: "slider.horizontal.3")
                .font(AlchemyTypography.subheading)
                .foregroundStyle(AlchemyColors.textPrimary)

            VStack(spacing: 0) {
                settingsRow("Skill Level") {
                    Picker("Skill Level", selection: $skillLevel) {
                        ForEach(skillLevels, id: \.self) { level in
                            Text(level).tag(level)
                        }
                    }
                    .pickerStyle(.menu)
                    .tint(AlchemyColors.accent)
                }

                Divider()

                settingsRow("Cooking For") {
                    TextField("People", text: $cookingFor)
                        .keyboardType(.numberPad)
                        .multilineTextAlignment(.trailing)
                        .frame(maxWidth: 60)
                }

                Divider()

                VStack(alignment: .leading, spacing: AlchemySpacing.sm) {
                    HStack {
                        Text("Max Difficulty")
                            .font(AlchemyTypography.body)
                            .foregroundStyle(AlchemyColors.textPrimary)
                        Spacer()
                        Text(difficultyLabel)
                            .font(AlchemyTypography.caption)
                            .foregroundStyle(AlchemyColors.accent)
                            .fontWeight(.medium)
                    }
                    Slider(value: $maxDifficulty, in: 0...1)
                        .tint(AlchemyColors.accent)
                }
                .padding(.vertical, AlchemySpacing.md)
            }
            .padding(.horizontal, AlchemySpacing.md)
            .background(AlchemyColors.surface)
            .clipShape(RoundedRectangle(cornerRadius: 12))

            if let errorMessage {
                Text(errorMessage)
                    .foregroundStyle(.red)
                    .font(AlchemyTypography.caption)
            }
        }
    }

    private func settingsRow<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        HStack {
            Text(title)
                .font(AlchemyTypography.body)
                .foregroundStyle(AlchemyColors.textPrimary)
            Spacer()
            content()
        }
        .padding(.vertical, AlchemySpacing.md)
    }

    // MARK: - Sous Chef Profile

    private var sousChefProfileSection: some View {
        VStack(alignment: .leading, spacing: AlchemySpacing.md) {
            Label("Sous Chef Profile", systemImage: "sparkles")
                .font(AlchemyTypography.subheading)
                .foregroundStyle(AlchemyColors.textPrimary)

            Text("Complex preferences are managed through conversation with your Sous Chef for more nuanced results.")
                .font(AlchemyTypography.caption)
                .foregroundStyle(AlchemyColors.textTertiary)

            VStack(spacing: 0) {
                profileRow("Dietary Preferences", values: profile.dietaryPreferences)
                Divider()
                profileRow("Dietary Restrictions", values: profile.dietaryRestrictions)
                Divider()
                profileRow("Equipment", values: profile.equipment)
                Divider()
                profileRow("Favorite Cuisines", values: profile.cuisines)
                Divider()
                profileRow("Aversions", values: profile.aversions)

                if let freeForm = profile.freeForm, !freeForm.isEmpty {
                    Divider()
                    VStack(alignment: .leading, spacing: AlchemySpacing.xs) {
                        Text("Notes")
                            .font(AlchemyTypography.caption)
                            .foregroundStyle(AlchemyColors.textTertiary)
                        Text(freeForm)
                            .font(AlchemyTypography.body)
                            .foregroundStyle(AlchemyColors.textSecondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, AlchemySpacing.md)
                }
            }
            .padding(.horizontal, AlchemySpacing.md)
            .background(AlchemyColors.surface)
            .clipShape(RoundedRectangle(cornerRadius: 12))

            // CTA to jump to Sous Chef tab
            Button {
                dismiss()
                if let selectedTab {
                    // Small delay so the sheet dismiss animation completes
                    // before the tab switch, avoiding visual stutter.
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                        selectedTab.wrappedValue = .sousChef
                    }
                }
            } label: {
                HStack(spacing: AlchemySpacing.sm) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 14, weight: .semibold))
                    Text("Chat with Sous Chef")
                        .font(AlchemyTypography.body.weight(.semibold))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, AlchemySpacing.md)
                .foregroundStyle(.white)
                .background(AlchemyColors.accent)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
        }
    }

    private func profileRow(_ title: String, values: [String]?) -> some View {
        HStack(alignment: .top) {
            Text(title)
                .font(AlchemyTypography.body)
                .foregroundStyle(AlchemyColors.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)

            if let values, !values.isEmpty {
                Text(values.joined(separator: ", "))
                    .font(AlchemyTypography.body)
                    .foregroundStyle(AlchemyColors.textSecondary)
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            } else {
                Text("Not set")
                    .font(AlchemyTypography.body)
                    .foregroundStyle(AlchemyColors.textTertiary)
                    .italic()
            }
        }
        .padding(.vertical, AlchemySpacing.md)
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
            populateQuickSettings(from: p)
        } catch {
            errorMessage = "Couldn't load your preferences."
            print("[PreferencesView] load failed: \(error)")
        }
    }

    /// Saves only the Quick Settings fields (skill, household, difficulty).
    /// Sous Chef Profile fields are read-only here — they're changed via chat.
    private func saveQuickSettings() async {
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }

        let apiSkillLevel = Self.skillLevelMap.first { $0.display == skillLevel }?.api ?? "intermediate"
        // Slider 0-1 maps to API 1-5 integer scale
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
            errorMessage = "Failed to save preferences. Please try again."
            print("[PreferencesView] save failed: \(error)")
        }
    }

    // MARK: - Helpers

    private func populateQuickSettings(from p: PreferenceProfile) {
        let apiSkill = (p.skillLevel ?? "intermediate").lowercased()
        skillLevel = Self.skillLevelMap.first { $0.api == apiSkill }?.display ?? "Home Cook"
        cookingFor = p.cookingFor ?? ""

        // API stores max_difficulty as 1-5 integer scale; slider uses 0-1
        let rawDifficulty = p.maxDifficulty ?? 3.0
        maxDifficulty = rawDifficulty <= 1.0 ? rawDifficulty : min(rawDifficulty / 5.0, 1.0)
    }
}
