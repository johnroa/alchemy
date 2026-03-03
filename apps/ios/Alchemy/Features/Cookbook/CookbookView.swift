import SwiftUI

struct CookbookView: View {
    @Environment(APIClient.self) private var api
    @State private var vm = CookbookViewModel()
    @Namespace private var recipeAnimation
    @Binding var showPreferences: Bool
    @Binding var showSettings: Bool
    @State private var filterSelection: String?

    var body: some View {
        NavigationStack {
            ZStack {
                AlchemyColors.deepDark.ignoresSafeArea()

                if vm.isLoading && vm.recipes.isEmpty {
                    loadingView
                } else if let error = vm.error, vm.recipes.isEmpty {
                    errorView(error)
                } else {
                    cookbookContent
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            .refreshable {
                await vm.refresh(api: api)
            }
            .task {
                if vm.recipes.isEmpty {
                    await vm.load(api: api)
                }
            }
            .navigationDestination(for: String.self) { recipeId in
                RecipeDetailView(recipeId: recipeId, namespace: recipeAnimation)
            }
            .onChange(of: filterSelection) { _, newValue in
                vm.selectedCategory = newValue ?? "All"
            }
        }
    }

    // MARK: - Content

    private var cookbookContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.md) {
                AlchemyTopNav(
                    title: "Cookbook",
                    trailingAction: { showSettings = true }
                )
                .padding(.bottom, Spacing.sm)

                Text("You’ve been putting together a great cookbook of gluten free hits")
                    .font(AlchemyFont.body)
                    .foregroundStyle(AlchemyColors.textTertiary)
                    .padding(.horizontal, Spacing.md)

                AlchemySearchBar(text: $vm.searchText)
                    .padding(.horizontal, Spacing.md)

                if vm.categories.count > 2 {
                    AlchemyFilterRow(
                        filters: vm.categories.filter { $0 != "All" },
                        selected: $filterSelection
                    )
                }

                if vm.filteredRecipes.isEmpty {
                    emptyView
                } else {
                    staggeredGrid
                }
            }
            .padding(.bottom, Sizing.tabBarHeight + Spacing.xl)
        }
    }

    // MARK: - Staggered Grid

    private var staggeredGrid: some View {
        let columns = splitIntoColumns(vm.filteredRecipes)

        return HStack(alignment: .top, spacing: Spacing.sm2) {
            // Left column
            LazyVStack(spacing: Spacing.sm2) {
                ForEach(columns.left) { card in
                    NavigationLink(value: card.id) {
                        AlchemyRecipeCard(
                            title: card.title,
                            summary: card.summary,
                            imageURL: card.imageUrl,
                            category: card.category
                        )
                        .matchedGeometryEffect(id: card.id, in: recipeAnimation)
                    }
                    .buttonStyle(.plain)
                }
            }

            // Right column — offset 32pt down
            LazyVStack(spacing: Spacing.sm2) {
                ForEach(columns.right) { card in
                    NavigationLink(value: card.id) {
                        AlchemyRecipeCard(
                            title: card.title,
                            summary: card.summary,
                            imageURL: card.imageUrl,
                            category: card.category
                        )
                        .matchedGeometryEffect(id: card.id, in: recipeAnimation)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.top, Spacing.xl)
        }
        .padding(.horizontal, Spacing.md)
    }

    private func splitIntoColumns(_ items: [RecipeCard]) -> (left: [RecipeCard], right: [RecipeCard]) {
        var left: [RecipeCard] = []
        var right: [RecipeCard] = []
        for (index, item) in items.enumerated() {
            if index.isMultiple(of: 2) {
                left.append(item)
            } else {
                right.append(item)
            }
        }
        return (left, right)
    }

    // MARK: - States

    private var loadingView: some View {
        ScrollView {
            HStack(alignment: .top, spacing: Spacing.sm2) {
                VStack(spacing: Spacing.sm2) {
                    ForEach(0..<3, id: \.self) { _ in
                        RecipeCardSkeleton()
                    }
                }
                VStack(spacing: Spacing.sm2) {
                    ForEach(0..<3, id: \.self) { _ in
                        RecipeCardSkeleton()
                    }
                }
                .padding(.top, Spacing.xl)
            }
            .padding(.horizontal, Spacing.md)
            .padding(.top, Spacing.sm)
        }
    }

    private func errorView(_ message: String) -> some View {
        VStack(spacing: Spacing.md) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 40))
                .foregroundStyle(AlchemyColors.warning)

            Text("Could not load cookbook")
                .font(AlchemyFont.titleMD)
                .foregroundStyle(AlchemyColors.textPrimary)

            Text(message)
                .font(AlchemyFont.bodySmall)
                .foregroundStyle(AlchemyColors.textSecondary)
                .multilineTextAlignment(.center)

            AlchemyButton(title: "Retry", variant: .secondary) {
                Task { await vm.load(api: api) }
            }
            .frame(width: 140)
        }
        .padding(Spacing.xl)
    }

    private var emptyView: some View {
        VStack(spacing: Spacing.md) {
            Image(systemName: "book.closed")
                .font(.system(size: 48))
                .foregroundStyle(AlchemyColors.grey1)

            Text(vm.searchText.isEmpty ? "No recipes yet" : "No results")
                .font(AlchemyFont.titleMD)
                .foregroundStyle(AlchemyColors.textPrimary)

            Text(vm.searchText.isEmpty
                ? "Generate your first recipe on the Generate tab."
                : "Try a different search term.")
                .font(AlchemyFont.bodySmall)
                .foregroundStyle(AlchemyColors.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, Spacing.xxxl)
    }
}
