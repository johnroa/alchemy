import SwiftUI

/// Stub preferences form matching the PreferenceProfile from the API.
///
/// Nine preference fields organized in sections. When wired to the API,
/// this will load from GET /preferences and save via PATCH /preferences.
/// Each section uses native SwiftUI form controls styled for dark mode.
struct PreferencesView: View {
    @Environment(\.dismiss) private var dismiss

    // Stub state — will be replaced by API-driven model
    @State private var dietaryPreferences = ""
    @State private var dietaryRestrictions = ""
    @State private var skillLevel = "Home Cook"
    @State private var equipment = ""
    @State private var cuisines = ""
    @State private var aversions = ""
    @State private var cookingFor = "2"
    @State private var maxDifficulty = 0.5
    @State private var freeForm = ""

    private let skillLevels = ["Beginner", "Home Cook", "Experienced", "Professional"]

    var body: some View {
        NavigationStack {
            Form {
                Section("Dietary") {
                    TextField("Preferences (e.g., vegetarian, keto)", text: $dietaryPreferences)
                    TextField("Restrictions (e.g., gluten-free, nut allergy)", text: $dietaryRestrictions)
                }

                Section("Skill & Equipment") {
                    Picker("Skill Level", selection: $skillLevel) {
                        ForEach(skillLevels, id: \.self) { level in
                            Text(level).tag(level)
                        }
                    }

                    TextField("Equipment (e.g., oven, stand mixer, grill)", text: $equipment)
                }

                Section("Taste") {
                    TextField("Favorite cuisines", text: $cuisines)
                    TextField("Aversions / dislikes", text: $aversions)
                }

                Section("Household") {
                    TextField("Cooking for (number of people)", text: $cookingFor)
                        .keyboardType(.numberPad)

                    VStack(alignment: .leading) {
                        Text("Max Difficulty: \(maxDifficulty < 0.33 ? "Easy" : maxDifficulty < 0.66 ? "Medium" : "Hard")")
                        Slider(value: $maxDifficulty, in: 0...1)
                            .tint(AlchemyColors.accent)
                    }
                }

                Section("Anything Else") {
                    TextField("Free-form notes for the chef...", text: $freeForm, axis: .vertical)
                        .lineLimit(3...6)
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
                        // Will call PATCH /preferences
                        dismiss()
                    }
                    .fontWeight(.semibold)
                }
            }
        }
    }
}
