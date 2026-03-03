import SwiftUI

private enum PreferencesSection: String, CaseIterable, Identifiable {
    case profile
    case diet
    case kitchen
    case style

    var id: String { rawValue }

    var title: String {
        switch self {
        case .profile: return "Profile Context"
        case .diet: return "Diet & Boundaries"
        case .kitchen: return "Kitchen Setup"
        case .style: return "Style & Difficulty"
        }
    }

    var subtitle: String {
        switch self {
        case .profile:
            return "Define your chef profile and who you typically cook for."
        case .diet:
            return "Clarify what you prefer and what must be avoided."
        case .kitchen:
            return "List special equipment and cuisines so recipes stay practical."
        case .style:
            return "Set your comfort level and cap the maximum complexity."
        }
    }
}

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
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    smartSummaryCard
                    sectionJumpBar(proxy: proxy)

                    sectionCard(.profile) {
                        prefField(
                            "About You",
                            text: $vm.freeForm,
                            placeholder: "Your chef profile: style, goals, and how you like to cook",
                            details: "Tell Alchemy a little bit about you as a chef.",
                            maxCharacters: PreferencesViewModel.Limits.aboutYou,
                            minLines: 3,
                            maxLines: 10
                        )

                        prefField(
                            "Cooking For",
                            text: $vm.cookingFor,
                            placeholder: "Family of 4, weeknight dinners for two, just me",
                            details: "Include household size or recurring scenarios.",
                            maxCharacters: PreferencesViewModel.Limits.cookingFor
                        )
                    }

                    sectionCard(.diet) {
                        prefField(
                            "Dietary Preferences",
                            text: $vm.dietaryPreferences,
                            placeholder: "I like seafood, high-protein meals, and lighter dinners",
                            details: "Share foods and styles you like or dislike. These guide recipe suggestions.",
                            maxCharacters: PreferencesViewModel.Limits.dietaryPreferences
                        )

                        prefField(
                            "Dietary Restrictions",
                            text: $vm.dietaryRestrictions,
                            placeholder: "Peanut allergy, gluten intolerance, no pork",
                            details: "List strict limits like allergies, intolerances, medical, ethical, or religious restrictions.",
                            maxCharacters: PreferencesViewModel.Limits.dietaryRestrictions
                        )

                        prefField(
                            "Ingredients You Dislike",
                            text: $vm.aversions,
                            placeholder: "Cilantro, olives, raw onion",
                            details: "Tell us ingredients or textures you want us to avoid.",
                            maxCharacters: PreferencesViewModel.Limits.aversions
                        )
                    }

                    sectionCard(.kitchen) {
                        prefField(
                            "Special Equipment",
                            text: $vm.equipment,
                            placeholder: "Pizza steel, smoker, sous vide, stand mixer",
                            details: "List only special tools beyond basics like bowls, spoons, and standard pans.",
                            maxCharacters: PreferencesViewModel.Limits.equipment
                        )

                        prefField(
                            "Cuisines",
                            text: $vm.cuisines,
                            placeholder: "Mediterranean and Japanese-inspired",
                            details: "Tell us which cuisines you want to see more often.",
                            maxCharacters: PreferencesViewModel.Limits.cuisines
                        )
                    }

                    sectionCard(.style) {
                        prefField(
                            "Skill Level",
                            text: $vm.skillLevel,
                            placeholder: "Beginner, intermediate, advanced",
                            details: "This helps calibrate instruction detail and pacing.",
                            maxCharacters: PreferencesViewModel.Limits.skillLevel
                        )

                        VStack(alignment: .leading, spacing: Spacing.sm2) {
                            HStack {
                                Text("Max Difficulty")
                                    .font(AlchemyFont.caption)
                                    .foregroundStyle(AlchemyColors.textSecondary)
                                Spacer()
                                Text("\(Int(vm.maxDifficulty))/5")
                                    .font(AlchemyFont.bodyBold)
                                    .foregroundStyle(AlchemyColors.gold)
                            }

                            Slider(value: $vm.maxDifficulty, in: 1...5, step: 1)
                                .tint(AlchemyColors.gold)

                            HStack {
                                Text("Quick and simple")
                                    .font(AlchemyFont.micro)
                                    .foregroundStyle(AlchemyColors.textTertiary)
                                Spacer()
                                Text("Technical and advanced")
                                    .font(AlchemyFont.micro)
                                    .foregroundStyle(AlchemyColors.textTertiary)
                            }
                        }
                        .padding(Spacing.md)
                        .background(inputBackground)
                    }

                    if let error = vm.error {
                        Text(error)
                            .font(AlchemyFont.captionLight)
                            .foregroundStyle(AlchemyColors.danger)
                    }
                }
                .padding(.horizontal, Spacing.md)
                .padding(.top, Spacing.md)
                .padding(.bottom, Spacing.xxxl)
            }
            .scrollIndicators(.hidden)
            .scrollDismissesKeyboard(.interactively)
        }
    }

    private var smartSummaryCard: some View {
        VStack(alignment: .leading, spacing: Spacing.sm2) {
            HStack(alignment: .center) {
                Text("Smart Profile Summary")
                    .font(AlchemyFont.headline)
                    .foregroundStyle(AlchemyColors.textPrimary)
                Spacer()
                Text(vm.completionText)
                    .font(AlchemyFont.caption)
                    .foregroundStyle(AlchemyColors.gold)
            }

            ProgressView(value: vm.completionRatio)
                .tint(AlchemyColors.gold)

            Text(vm.smartHeadline)
                .font(AlchemyFont.bodyBold)
                .foregroundStyle(AlchemyColors.textPrimary)

            Text(vm.smartDetail)
                .font(AlchemyFont.bodySmall)
                .foregroundStyle(AlchemyColors.textSecondary)
                .fixedSize(horizontal: false, vertical: true)

            if !vm.missingSignals.isEmpty {
                HStack(alignment: .top, spacing: Spacing.sm) {
                    Text("Missing:")
                        .font(AlchemyFont.caption)
                        .foregroundStyle(AlchemyColors.textSecondary)

                    Text(vm.missingSignals.prefix(3).map(\.localizedCapitalized).joined(separator: " • "))
                        .font(AlchemyFont.captionLight)
                        .foregroundStyle(AlchemyColors.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(Spacing.md)
        .background(sectionBackground)
    }

    private func sectionJumpBar(proxy: ScrollViewProxy) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Spacing.sm) {
                ForEach(PreferencesSection.allCases) { section in
                    Button {
                        withAnimation(.spring(response: 0.35, dampingFraction: 0.86)) {
                            proxy.scrollTo(section.id, anchor: .top)
                        }
                    } label: {
                        Text(section.title)
                            .font(AlchemyFont.captionSmall)
                            .foregroundStyle(AlchemyColors.textPrimary)
                            .padding(.horizontal, Spacing.sm2)
                            .padding(.vertical, Spacing.sm)
                            .background(
                                Capsule()
                                    .fill(AlchemyColors.card.opacity(0.75))
                                    .overlay(
                                        Capsule()
                                            .stroke(Color.white.opacity(0.14), lineWidth: 0.8)
                                    )
                            )
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.vertical, 2)
        }
    }

    private func sectionCard<Content: View>(
        _ section: PreferencesSection,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm2) {
            Text(section.title)
                .font(AlchemyFont.titleMD)
                .foregroundStyle(AlchemyColors.textPrimary)

            Text(section.subtitle)
                .font(AlchemyFont.captionLight)
                .foregroundStyle(AlchemyColors.textSecondary)
                .fixedSize(horizontal: false, vertical: true)

            VStack(alignment: .leading, spacing: Spacing.md) {
                content()
            }
            .padding(Spacing.md)
            .background(sectionBackground)
        }
        .id(section.id)
    }

    private func prefField(
        _ label: String,
        text: Binding<String>,
        placeholder: String,
        details: String,
        maxCharacters: Int,
        minLines: Int = 1,
        maxLines: Int = 6
    ) -> some View {
        let limitedText = Binding<String>(
            get: { text.wrappedValue },
            set: { newValue in
                if newValue.count > maxCharacters {
                    text.wrappedValue = String(newValue.prefix(maxCharacters))
                } else {
                    text.wrappedValue = newValue
                }
            }
        )

        return VStack(alignment: .leading, spacing: Spacing.sm2) {
            HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                Text(label)
                    .font(AlchemyFont.caption)
                    .foregroundStyle(AlchemyColors.textSecondary)

                Spacer()

                Text("\(text.wrappedValue.count)/\(maxCharacters)")
                    .font(AlchemyFont.micro)
                    .foregroundStyle(AlchemyColors.textTertiary)
            }

            TextField(placeholder, text: limitedText, axis: .vertical)
                .font(AlchemyFont.body)
                .foregroundStyle(AlchemyColors.textPrimary)
                .tint(AlchemyColors.gold)
                .lineLimit(minLines...maxLines)
                .padding(.horizontal, Spacing.md)
                .padding(.vertical, Spacing.sm2)
                .background(inputBackground)

            Text(details)
                .font(AlchemyFont.captionLight)
                .foregroundStyle(AlchemyColors.textTertiary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var sectionBackground: some View {
        RoundedRectangle(cornerRadius: Radius.xl, style: .continuous)
            .fill(
                LinearGradient(
                    colors: [
                        Color(hex: 0x143E5B).opacity(0.45),
                        Color(hex: 0x0B1A2C).opacity(0.92)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .overlay(
                RoundedRectangle(cornerRadius: Radius.xl, style: .continuous)
                    .stroke(Color.white.opacity(0.1), lineWidth: 0.9)
            )
    }

    private var inputBackground: some View {
        RoundedRectangle(cornerRadius: Radius.lg, style: .continuous)
            .fill(AlchemyColors.card.opacity(0.92))
            .overlay(
                RoundedRectangle(cornerRadius: Radius.lg, style: .continuous)
                    .stroke(Color.white.opacity(0.12), lineWidth: 0.8)
            )
    }
}
