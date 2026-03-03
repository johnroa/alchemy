import SwiftUI
import NukeUI

struct ExploreView: View {
    @Environment(APIClient.self) private var api
    @State private var vm = ExploreViewModel()
    @Namespace private var exploreAnimation

    var body: some View {
        NavigationStack {
            ZStack {
                AlchemyColors.deepDark.ignoresSafeArea()

                if vm.isLoading && vm.recipes.isEmpty {
                    loadingView
                } else if let error = vm.error, vm.recipes.isEmpty {
                    errorView(error)
                } else if vm.recipes.isEmpty {
                    emptyView
                } else {
                    cardStack
                }
            }
            .navigationDestination(for: String.self) { recipeId in
                RecipeDetailView(recipeId: recipeId, namespace: exploreAnimation)
            }
            .task {
                if vm.recipes.isEmpty {
                    await vm.load(api: api)
                }
            }
        }
    }

    // MARK: - Card Stack

    private var cardStack: some View {
        ScrollView(.vertical) {
            LazyVStack(spacing: 0) {
                ForEach(vm.recipes) { recipe in
                    NavigationLink(value: recipe.id) {
                        exploreCard(recipe)
                    }
                    .buttonStyle(.plain)
                }
            }
            .scrollTargetLayout()
        }
        .scrollTargetBehavior(.paging)
        .ignoresSafeArea()
    }

    // MARK: - Explore Card

    private func exploreCard(_ recipe: RecipeCard) -> some View {
        GeometryReader { geo in
            let minY = geo.frame(in: .global).minY
            let screenHeight = geo.size.height
            let parallax = -(minY / screenHeight) * 40

            ZStack(alignment: .bottomLeading) {
                // Full-bleed image
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
                    .offset(y: parallax)
                } else {
                    AlchemyColors.card
                        .overlay {
                            Image(systemName: "fork.knife")
                                .font(.system(size: 48))
                                .foregroundStyle(AlchemyColors.grey1.opacity(0.3))
                        }
                }

                // Dark overlay
                LinearGradient(
                    colors: [
                        .clear,
                        Color.black.opacity(0.3),
                        Color.black.opacity(0.75)
                    ],
                    startPoint: .center,
                    endPoint: .bottom
                )

                // Text overlay
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    if let category = recipe.category {
                        Text(category.uppercased())
                            .font(AlchemyFont.captionSmall)
                            .foregroundStyle(AlchemyColors.gold)
                            .tracking(1.5)
                    }

                    Text(recipe.title)
                        .font(AlchemyFont.serifLG)
                        .foregroundStyle(.white)
                        .lineLimit(3)

                    Text(recipe.summary)
                        .font(AlchemyFont.bodySmallLight)
                        .foregroundStyle(.white.opacity(0.8))
                        .lineLimit(2)

                    // Open recipe pill
                    HStack(spacing: Spacing.xs) {
                        Text("Open Recipe")
                            .font(AlchemyFont.caption)
                        Image(systemName: "arrow.right")
                            .font(.system(size: 12, weight: .semibold))
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, Spacing.md)
                    .padding(.vertical, Spacing.sm)
                    .alchemyGlassCapsule()
                    .padding(.top, Spacing.sm)
                }
                .padding(Spacing.lg)
                .padding(.bottom, Sizing.tabBarHeight + Spacing.lg)
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .clipped()
            .matchedGeometryEffect(id: recipe.id, in: exploreAnimation)
        }
        .containerRelativeFrame([.horizontal, .vertical])
    }

    // MARK: - States

    private var loadingView: some View {
        VStack(spacing: Spacing.md) {
            ProgressView()
                .tint(AlchemyColors.grey2)
            Text("Loading recipes...")
                .font(AlchemyFont.body)
                .foregroundStyle(AlchemyColors.textSecondary)
        }
    }

    private func errorView(_ message: String) -> some View {
        VStack(spacing: Spacing.md) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 40))
                .foregroundStyle(AlchemyColors.warning)

            Text(message)
                .font(AlchemyFont.bodySmall)
                .foregroundStyle(AlchemyColors.textSecondary)

            AlchemyButton(title: "Retry", variant: .secondary) {
                Task { await vm.load(api: api) }
            }
            .frame(width: 140)
        }
    }

    private var emptyView: some View {
        VStack(spacing: Spacing.md) {
            Image(systemName: "safari")
                .font(.system(size: 48))
                .foregroundStyle(AlchemyColors.grey1)

            Text("Nothing to explore yet")
                .font(AlchemyFont.titleMD)
                .foregroundStyle(AlchemyColors.textPrimary)

            Text("Generate some recipes first, then come back to discover them here.")
                .font(AlchemyFont.bodySmall)
                .foregroundStyle(AlchemyColors.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, Spacing.xl)
        }
    }
}
