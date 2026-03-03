import SwiftUI

struct PreferencesView: View {
    @Environment(APIClient.self) private var api
    @Environment(\.dismiss) private var dismiss
    @State private var vm = PreferencesViewModel()

    var body: some View {
        NavigationStack {
            ZStack {
                AlchemyColors.deepDark.ignoresSafeArea()

                if vm.isLoading && !vm.hasLoaded {
                    ProgressView()
                        .tint(AlchemyColors.grey2)
                } else {
                    formContent
                }
            }
            .navigationTitle("Preferences")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Close") { dismiss() }
                        .foregroundStyle(AlchemyColors.grey2)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await vm.save(api: api) }
                    } label: {
                        if vm.isSaving {
                            ProgressView()
                                .tint(AlchemyColors.gold)
                                .scaleEffect(0.8)
                        } else {
                            Text("Save")
                                .fontWeight(.semibold)
                                .foregroundStyle(AlchemyColors.gold)
                        }
                    }
                    .disabled(vm.isSaving)
                }
            }
            .task {
                if !vm.hasLoaded {
                    await vm.load(api: api)
                }
            }
        }
    }

    private var formContent: some View {
        ScrollView {
            VStack(spacing: Spacing.lg) {
                prefField("About You", text: $vm.freeForm, placeholder: "Tell us about yourself and your cooking style", axis: .vertical)
                prefField("Equipment", text: $vm.equipment, placeholder: "Oven, air fryer, instant pot...")
                prefField("Dietary Preferences", text: $vm.dietaryPreferences, placeholder: "Vegetarian, low-carb...")
                prefField("Dietary Restrictions", text: $vm.dietaryRestrictions, placeholder: "Gluten-free, nut allergy...")
                prefField("Skill Level", text: $vm.skillLevel, placeholder: "Beginner, intermediate, advanced")
                prefField("Cuisines", text: $vm.cuisines, placeholder: "Italian, Japanese, Mexican...")
                prefField("Aversions", text: $vm.aversions, placeholder: "Cilantro, olives...")
                prefField("Cooking For", text: $vm.cookingFor, placeholder: "Family of 4, just me...")

                // Max difficulty slider
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    HStack {
                        Text("Max Difficulty")
                            .font(AlchemyFont.caption)
                            .foregroundStyle(AlchemyColors.textSecondary)
                        Spacer()
                        Text("\(Int(vm.maxDifficulty))")
                            .font(AlchemyFont.bodyBold)
                            .foregroundStyle(AlchemyColors.gold)
                    }

                    Slider(value: $vm.maxDifficulty, in: 1...5, step: 1)
                        .tint(AlchemyColors.gold)

                    HStack {
                        Text("Easy")
                            .font(AlchemyFont.micro)
                            .foregroundStyle(AlchemyColors.textTertiary)
                        Spacer()
                        Text("Expert")
                            .font(AlchemyFont.micro)
                            .foregroundStyle(AlchemyColors.textTertiary)
                    }
                }

                if let error = vm.error {
                    Text(error)
                        .font(AlchemyFont.captionLight)
                        .foregroundStyle(AlchemyColors.danger)
                }
            }
            .padding(Spacing.md)
        }
    }

    @ViewBuilder
    private func prefField(
        _ label: String,
        text: Binding<String>,
        placeholder: String,
        axis: Axis = .horizontal
    ) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text(label)
                .font(AlchemyFont.caption)
                .foregroundStyle(AlchemyColors.textSecondary)

            if axis == .vertical {
                TextField(placeholder, text: text, axis: .vertical)
                    .font(AlchemyFont.body)
                    .foregroundStyle(AlchemyColors.textPrimary)
                    .tint(AlchemyColors.gold)
                    .lineLimit(3...6)
                    .padding(Spacing.md)
                    .background(AlchemyColors.card)
                    .clipShape(RoundedRectangle(cornerRadius: Radius.lg))
            } else {
                TextField(placeholder, text: text)
                    .font(AlchemyFont.body)
                    .foregroundStyle(AlchemyColors.textPrimary)
                    .tint(AlchemyColors.gold)
                    .padding(Spacing.md)
                    .frame(height: Sizing.fieldHeight)
                    .background(AlchemyColors.card)
                    .clipShape(RoundedRectangle(cornerRadius: Radius.lg))
            }
        }
    }
}
