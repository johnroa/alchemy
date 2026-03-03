import SwiftUI
import NukeUI

struct RecipeDetailView: View {
    @Environment(APIClient.self) private var api
    @State private var vm = RecipeDetailViewModel()
    let recipeId: String
    var namespace: Namespace.ID

    private let heroHeight: CGFloat = 380

    var body: some View {
        ZStack {
            AlchemyColors.deepDark.ignoresSafeArea()

            if vm.isLoading && vm.recipe == nil {
                ProgressView()
                    .tint(AlchemyColors.grey2)
            } else if let error = vm.error, vm.recipe == nil {
                errorView(error)
            } else if let recipe = vm.recipe {
                recipeContent(recipe)
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .task {
            await vm.load(recipeId: recipeId, api: api)
        }
    }

    // MARK: - Recipe Content

    @ViewBuilder
    private func recipeContent(_ recipe: RecipeView) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                // Parallax hero
                heroSection(recipe)

                // Content
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    // Title + metadata
                    titleSection(recipe)

                    // Nutrition
                    if let nutrition = recipe.metadata?.nutrition {
                        NutritionWidget(
                            calories: nutrition.calories,
                            proteinG: nutrition.proteinG,
                            carbsG: nutrition.carbsG,
                            fatG: nutrition.fatG
                        )
                    }

                    // Timing badges
                    if let timing = recipe.metadata?.timing {
                        timingSection(timing)
                    }

                    // Ingredients
                    ingredientSection(recipe.ingredients)

                    // Steps
                    stepSection(recipe.steps)

                    // Notes
                    if let notes = recipe.notes, !notes.isEmpty {
                        notesSection(notes)
                    }

                    // Pairings
                    if !recipe.pairings.isEmpty {
                        pairingsSection(recipe.pairings)
                    }

                    // Version history
                    if let history = vm.history, !history.versions.isEmpty {
                        historySection(history.versions)
                    }

                    // Action buttons
                    actionButtons(recipe)
                }
                .padding(.horizontal, Spacing.md)
                .padding(.bottom, Sizing.tabBarHeight + Spacing.xxxl)
            }
        }
        .ignoresSafeArea(.container, edges: .top)
    }

    // MARK: - Hero

    private func heroSection(_ recipe: RecipeView) -> some View {
        GeometryReader { geo in
            let minY = geo.frame(in: .scrollView).minY
            let parallaxOffset = minY > 0 ? -minY * 0.4 : 0

            ZStack(alignment: .bottomLeading) {
                if let imageUrl = recipe.imageUrl, let url = URL(string: imageUrl) {
                    LazyImage(url: url) { state in
                        if let image = state.image {
                            image
                                .resizable()
                                .aspectRatio(contentMode: .fill)
                        } else {
                            AlchemyColors.card
                        }
                    }
                    .frame(width: geo.size.width, height: heroHeight + max(minY, 0))
                    .offset(y: parallaxOffset)
                    .clipped()
                } else {
                    AlchemyColors.card
                        .frame(height: heroHeight)
                }

                // Gradient overlay
                LinearGradient(
                    colors: [.clear, AlchemyColors.deepDark.opacity(0.7), AlchemyColors.deepDark],
                    startPoint: .top,
                    endPoint: .bottom
                )
            }
            .frame(height: heroHeight + max(minY, 0))
            .offset(y: min(minY, 0))
        }
        .frame(height: heroHeight)
    }

    // MARK: - Title Section

    private func titleSection(_ recipe: RecipeView) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            if let category = recipe.category {
                Text(category.uppercased())
                    .font(AlchemyFont.captionSmall)
                    .foregroundStyle(AlchemyColors.gold)
                    .tracking(1.2)
            }

            Text(recipe.title)
                .font(AlchemyFont.serifLG)
                .foregroundStyle(AlchemyColors.textPrimary)

            Text(recipe.summary)
                .font(AlchemyFont.bodySmallLight)
                .foregroundStyle(AlchemyColors.textSecondary)
                .lineSpacing(4)

            // Tags
            if let tags = recipe.metadata?.cuisineTags, !tags.isEmpty {
                HStack(spacing: Spacing.xs) {
                    ForEach(tags, id: \.self) { tag in
                        Text(tag)
                            .font(AlchemyFont.captionSmall)
                            .foregroundStyle(AlchemyColors.textTertiary)
                            .padding(.horizontal, Spacing.sm)
                            .padding(.vertical, 4)
                            .background(AlchemyColors.card)
                            .clipShape(Capsule())
                    }
                }
            }
        }
        .padding(.top, -Spacing.lg)
    }

    // MARK: - Timing

    private func timingSection(_ timing: RecipeTiming) -> some View {
        HStack(spacing: Spacing.md) {
            if let prep = timing.prepMinutes {
                timingBadge(icon: "clock", label: "Prep", value: "\(prep)m")
            }
            if let cook = timing.cookMinutes {
                timingBadge(icon: "flame", label: "Cook", value: "\(cook)m")
            }
            if let total = timing.totalMinutes {
                timingBadge(icon: "timer", label: "Total", value: "\(total)m")
            }
        }
    }

    private func timingBadge(icon: String, label: String, value: String) -> some View {
        HStack(spacing: Spacing.xs) {
            Image(systemName: icon)
                .font(.system(size: 13))
                .foregroundStyle(AlchemyColors.gold)
            VStack(alignment: .leading, spacing: 1) {
                Text(label)
                    .font(AlchemyFont.micro)
                    .foregroundStyle(AlchemyColors.textTertiary)
                Text(value)
                    .font(AlchemyFont.captionSmall)
                    .foregroundStyle(AlchemyColors.textPrimary)
            }
        }
        .padding(.horizontal, Spacing.sm2)
        .padding(.vertical, Spacing.sm)
        .background(AlchemyColors.card)
        .clipShape(RoundedRectangle(cornerRadius: Radius.md))
    }

    // MARK: - Ingredients

    private func ingredientSection(_ ingredients: [RecipeIngredient]) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm2) {
            Text("Ingredients")
                .font(AlchemyFont.titleSM)
                .foregroundStyle(AlchemyColors.textPrimary)

            VStack(spacing: 0) {
                ForEach(ingredients) { ingredient in
                    HStack {
                        Text(ingredient.name)
                            .font(AlchemyFont.body)
                            .foregroundStyle(AlchemyColors.textPrimary)

                        Spacer()

                        Text("\(ingredient.displayAmount ?? formatAmount(ingredient.amount)) \(ingredient.unit)")
                            .font(AlchemyFont.bodySmall)
                            .foregroundStyle(AlchemyColors.textSecondary)
                    }
                    .padding(.vertical, Spacing.sm)

                    if ingredient.id != ingredients.last?.id {
                        Divider()
                            .overlay(Color.white.opacity(0.06))
                    }
                }
            }
            .padding(Spacing.md)
            .background(AlchemyColors.card)
            .clipShape(RoundedRectangle(cornerRadius: Radius.lg))
        }
    }

    private func formatAmount(_ amount: Double) -> String {
        amount.truncatingRemainder(dividingBy: 1) == 0
            ? String(format: "%.0f", amount)
            : String(format: "%.1f", amount)
    }

    // MARK: - Steps

    private func stepSection(_ steps: [RecipeStep]) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm2) {
            Text("Instructions")
                .font(AlchemyFont.titleSM)
                .foregroundStyle(AlchemyColors.textPrimary)

            VStack(spacing: Spacing.md) {
                ForEach(steps) { step in
                    HStack(alignment: .top, spacing: Spacing.sm2) {
                        Text("\(step.index)")
                            .font(AlchemyFont.caption)
                            .foregroundStyle(AlchemyColors.gold)
                            .frame(width: 24, height: 24)
                            .background(AlchemyColors.gold.opacity(0.12))
                            .clipShape(Circle())

                        VStack(alignment: .leading, spacing: Spacing.xs) {
                            Text(step.instruction)
                                .font(AlchemyFont.body)
                                .foregroundStyle(AlchemyColors.textPrimary)
                                .lineSpacing(3)

                            if let notes = step.notes, !notes.isEmpty {
                                Text(notes)
                                    .font(AlchemyFont.captionLight)
                                    .foregroundStyle(AlchemyColors.textTertiary)
                                    .italic()
                            }

                            if let timer = step.timerSeconds, timer > 0 {
                                HStack(spacing: 4) {
                                    Image(systemName: "timer")
                                        .font(.system(size: 12))
                                    Text("\(timer / 60) min")
                                        .font(AlchemyFont.captionSmall)
                                }
                                .foregroundStyle(AlchemyColors.info)
                            }
                        }
                    }
                }
            }
            .padding(Spacing.md)
            .background(AlchemyColors.card)
            .clipShape(RoundedRectangle(cornerRadius: Radius.lg))
        }
    }

    // MARK: - Notes

    private func notesSection(_ notes: String) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text("Notes")
                .font(AlchemyFont.titleSM)
                .foregroundStyle(AlchemyColors.textPrimary)

            Text(notes)
                .font(AlchemyFont.bodySmall)
                .foregroundStyle(AlchemyColors.textSecondary)
                .lineSpacing(3)
                .padding(Spacing.md)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(AlchemyColors.card)
                .clipShape(RoundedRectangle(cornerRadius: Radius.lg))
        }
    }

    // MARK: - Pairings

    private func pairingsSection(_ pairings: [String]) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text("Pairings")
                .font(AlchemyFont.titleSM)
                .foregroundStyle(AlchemyColors.textPrimary)

            VStack(alignment: .leading, spacing: Spacing.sm) {
                ForEach(pairings, id: \.self) { pairing in
                    HStack(spacing: Spacing.sm) {
                        Image(systemName: "wineglass")
                            .font(.system(size: 13))
                            .foregroundStyle(AlchemyColors.gold)
                        Text(pairing)
                            .font(AlchemyFont.bodySmall)
                            .foregroundStyle(AlchemyColors.textSecondary)
                    }
                }
            }
            .padding(Spacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(AlchemyColors.card)
            .clipShape(RoundedRectangle(cornerRadius: Radius.lg))
        }
    }

    // MARK: - History

    private func historySection(_ versions: [HistoryVersion]) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text("Version History")
                .font(AlchemyFont.titleSM)
                .foregroundStyle(AlchemyColors.textPrimary)

            VStack(spacing: Spacing.sm) {
                ForEach(versions) { version in
                    HStack(spacing: Spacing.sm2) {
                        Circle()
                            .fill(AlchemyColors.gold)
                            .frame(width: 8, height: 8)

                        VStack(alignment: .leading, spacing: 2) {
                            Text(version.diffSummary ?? "Initial version")
                                .font(AlchemyFont.captionLight)
                                .foregroundStyle(AlchemyColors.textPrimary)
                            Text(version.createdAt.prefix(10))
                                .font(AlchemyFont.micro)
                                .foregroundStyle(AlchemyColors.textTertiary)
                        }

                        Spacer()
                    }
                }
            }
            .padding(Spacing.md)
            .background(AlchemyColors.card)
            .clipShape(RoundedRectangle(cornerRadius: Radius.lg))
        }
    }

    // MARK: - Action Buttons

    private func actionButtons(_ recipe: RecipeView) -> some View {
        HStack(spacing: Spacing.sm2) {
            AlchemyButton(title: "Save to Cookbook", icon: "bookmark") {
                Task { await vm.saveRecipe(api: api) }
            }

            AlchemyButton(title: "Tweak", icon: "wand.and.stars", variant: .secondary) {
                // Navigate to Generate with this recipe for tweaking
                Haptics.fire(.light)
            }
        }
    }

    // MARK: - Error

    private func errorView(_ message: String) -> some View {
        VStack(spacing: Spacing.md) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 40))
                .foregroundStyle(AlchemyColors.warning)

            Text(message)
                .font(AlchemyFont.bodySmall)
                .foregroundStyle(AlchemyColors.textSecondary)
                .multilineTextAlignment(.center)

            AlchemyButton(title: "Retry", variant: .secondary) {
                Task { await vm.load(recipeId: recipeId, api: api) }
            }
            .frame(width: 140)
        }
        .padding(Spacing.xl)
    }
}
