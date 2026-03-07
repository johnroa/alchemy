import SwiftUI
import NukeUI

/// Cookbook screen — saved recipes displayed in a staggered masonry 2-column grid.
///
/// Data source: GET /recipes/cookbook. Falls back to empty state when no
/// recipes are saved. Supports pull-to-refresh and client-side filtering
/// by category and search text.
struct CookbookView: View {
    @State private var previews: [CookbookEntryItem] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var selectedPreview: CookbookEntryItem?
    @State private var navigateToRecipeId: String?
    @State private var showPreferences = false
    @State private var showSettings = false
    @State private var searchText = ""
    @State private var selectedFilter = "All"
    @State private var showFullScreenPreview = false

    /// System-generated placeholder categories that shouldn't surface as
    /// user-facing filter chips. These appear when the auto-categorization
    /// pipeline hasn't run yet or produced no real category.
    private static let systemCategories: Set<String> = [
        "auto organized", "uncategorized",
    ]

    /// Unique real categories derived from the loaded cookbook items,
    /// excluding system fallback categories that carry no user meaning.
    private var categories: [String] {
        let meaningful = Set(
            previews.map(\.category)
                .filter { !Self.systemCategories.contains($0.lowercased()) }
        )
        guard !meaningful.isEmpty else { return [] }
        return ["All"] + meaningful.sorted()
    }

    /// Filtered previews based on selected category and search text.
    /// When no meaningful categories exist (chips hidden), all recipes pass
    /// the category filter.
    private var filteredPreviews: [CookbookEntryItem] {
        previews.filter { preview in
            let matchesFilter = categories.isEmpty
                || selectedFilter == "All"
                || preview.category == selectedFilter
            let matchesSearch = searchText.isEmpty
                || preview.title.localizedCaseInsensitiveContains(searchText)
                || preview.summary.localizedCaseInsensitiveContains(searchText)
            return matchesFilter && matchesSearch
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                headerBar

                if isLoading && previews.isEmpty {
                    Spacer()
                    ProgressView()
                        .tint(.white)
                    Spacer()
                } else if let errorMessage, previews.isEmpty {
                    Spacer()
                    errorView(errorMessage)
                    Spacer()
                } else if previews.isEmpty {
                    Spacer()
                    emptyView
                    Spacer()
                } else {
                    ScrollView {
                        VStack(spacing: AlchemySpacing.md) {
                            searchBar
                            if !categories.isEmpty {
                                filterChips
                            }
                            masonryGrid
                        }
                        .padding(.bottom, AlchemySpacing.xxxl)
                    }
                    .refreshable { await loadCookbook() }
                }
            }
            .background(AlchemyColors.background)
            .navigationBarHidden(true)
            .overlay {
                if showFullScreenPreview, let preview = selectedPreview {
                    CookbookFullScreenPreview(
                        preview: preview,
                        onOpenRecipe: {
                            showFullScreenPreview = false
                            navigateToRecipeId = preview.id
                        },
                        onDismiss: {
                            withAnimation(.easeOut(duration: 0.3)) {
                                showFullScreenPreview = false
                            }
                        }
                    )
                    .transition(.opacity)
                }
            }
            .navigationDestination(item: $navigateToRecipeId) { recipeId in
                RecipeDetailView(recipeId: recipeId)
            }
            .sheet(isPresented: $showPreferences) {
                PreferencesView()
            }
            .sheet(isPresented: $showSettings) {
                SettingsView()
            }
            .toolbarVisibility(showFullScreenPreview ? .hidden : .automatic, for: .tabBar)
            .task { await loadCookbook() }
            .onAppear {
                // Refresh when returning from another tab (e.g. after
                // saving from Sous Chef) so new recipes appear immediately.
                Task { await loadCookbook() }
            }
        }
    }

    // MARK: - Header

    private var headerBar: some View {
        HStack {
            Text("Cookbook")
                .font(AlchemyTypography.heading)
                .foregroundStyle(AlchemyColors.textPrimary)

            Spacer()

            ProfileMenu(
                onPreferences: { showPreferences = true },
                onSettings: { showSettings = true }
            )
        }
        .padding(.horizontal, AlchemySpacing.screenHorizontal)
        .padding(.vertical, AlchemySpacing.md)
    }

    // MARK: - Search Bar

    private var searchBar: some View {
        HStack(spacing: AlchemySpacing.sm) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(AlchemyColors.textTertiary)

            TextField("Search recipes...", text: $searchText)
                .font(AlchemyTypography.body)
                .foregroundStyle(AlchemyColors.textPrimary)
        }
        .padding(.horizontal, AlchemySpacing.md)
        .padding(.vertical, AlchemySpacing.sm + 2)
        .background(AlchemyColors.surface)
        .clipShape(RoundedRectangle(cornerRadius: AlchemySpacing.buttonRadius))
        .padding(.horizontal, AlchemySpacing.screenHorizontal)
    }

    // MARK: - Filter Labels

    private var filterChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: AlchemySpacing.lg) {
                ForEach(categories, id: \.self) { filter in
                    Button {
                        withAnimation(.easeInOut(duration: 0.2)) {
                            selectedFilter = filter
                        }
                    } label: {
                        Text(filter)
                            .font(.system(size: 18, weight: selectedFilter == filter ? .bold : .regular))
                            .foregroundStyle(
                                AlchemyColors.textPrimary
                                    .opacity(selectedFilter == filter ? 1.0 : 0.5)
                            )
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, AlchemySpacing.screenHorizontal)
            .padding(.vertical, AlchemySpacing.md)
        }
    }

    // MARK: - Masonry Grid

    private var masonryGrid: some View {
        let cards = filteredPreviews
        let leftCards = cards.enumerated().filter { $0.offset % 2 == 0 }.map(\.element)
        let rightCards = cards.enumerated().filter { $0.offset % 2 != 0 }.map(\.element)

        return HStack(alignment: .top, spacing: AlchemySpacing.gridSpacing) {
            LazyVStack(spacing: AlchemySpacing.gridSpacing) {
                ForEach(leftCards) { preview in
                    cardCell(preview)
                }
            }

            LazyVStack(spacing: AlchemySpacing.gridSpacing) {
                ForEach(rightCards) { preview in
                    cardCell(preview)
                }
            }
        }
        .padding(.horizontal, AlchemySpacing.screenHorizontal)
    }

    private func cardCell(_ preview: CookbookEntryItem) -> some View {
        RecipeCardView(card: preview.asRecipeCard)
            .overlay(alignment: .topTrailing) {
                variantBadge(for: preview)
            }
            .onTapGesture {
                selectedPreview = preview
                withAnimation(.easeInOut(duration: 0.3)) {
                    showFullScreenPreview = true
                }
            }
            .contextMenu {
                Button {
                    selectedPreview = preview
                    withAnimation { showFullScreenPreview = true }
                } label: {
                    Label("View", systemImage: "eye")
                }

                Button {
                    // Edit — will navigate to Sous Chef with recipe loaded
                } label: {
                    Label("Edit", systemImage: "pencil")
                }

                ShareLink(
                    item: preview.title,
                    subject: Text(preview.title),
                    message: Text(preview.summary)
                ) {
                    Label("Share", systemImage: "square.and.arrow.up")
                }

                Divider()

                Button(role: .destructive) {
                    Task { await unsaveRecipe(preview.id) }
                } label: {
                    Label("Remove", systemImage: "trash")
                }
            }
    }

    /// Small badge overlay indicating variant personalisation state.
    /// Only shows when a variant is active. Uses sparkles for current,
    /// exclamation for stale/needs_review, xmark for failed.
    @ViewBuilder
    private func variantBadge(for entry: CookbookEntryItem) -> some View {
        switch entry.variantStatus {
        case "current":
            Image(systemName: "sparkles")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(.white)
                .padding(5)
                .background(AlchemyColors.accent)
                .clipShape(Circle())
                .padding(6)
        case "processing":
            ProgressView()
                .controlSize(.mini)
                .padding(5)
                .background(.ultraThinMaterial)
                .clipShape(Circle())
                .padding(6)
        case "stale", "needs_review":
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(.white)
                .padding(5)
                .background(.orange)
                .clipShape(Circle())
                .padding(6)
        case "failed":
            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(.white)
                .padding(5)
                .background(.red)
                .clipShape(Circle())
                .padding(6)
        default:
            EmptyView()
        }
    }

    // MARK: - Empty / Error States

    private var emptyView: some View {
        VStack(spacing: AlchemySpacing.md) {
            Image(systemName: "book.closed")
                .font(.system(size: 48))
                .foregroundStyle(AlchemyColors.textTertiary)
            Text("No recipes yet")
                .font(AlchemyTypography.subheading)
                .foregroundStyle(AlchemyColors.textSecondary)
            Text("Ask your Sous Chef to create your first recipe.")
                .font(AlchemyTypography.body)
                .foregroundStyle(AlchemyColors.textTertiary)
        }
    }

    private func errorView(_ message: String) -> some View {
        VStack(spacing: AlchemySpacing.md) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 48))
                .foregroundStyle(AlchemyColors.textTertiary)
            Text(message)
                .font(AlchemyTypography.body)
                .foregroundStyle(AlchemyColors.textSecondary)
                .multilineTextAlignment(.center)
            Button("Retry") {
                Task { await loadCookbook() }
            }
            .foregroundStyle(AlchemyColors.accent)
        }
        .padding(.horizontal, AlchemySpacing.screenHorizontal)
    }

    // MARK: - API

    private func loadCookbook() async {
        if previews.isEmpty { isLoading = true }
        errorMessage = nil

        do {
            let response: CookbookResponse = try await APIClient.shared.request("/recipes/cookbook")
            previews = response.items
        } catch {
            errorMessage = "Couldn't load your cookbook. Check your connection."
            print("[CookbookView] load failed: \(error)")
        }

        isLoading = false
    }

    private func unsaveRecipe(_ id: String) async {
        do {
            try await APIClient.shared.requestVoid("/recipes/\(id)/save", method: .delete)
            withAnimation {
                previews.removeAll { $0.id == id }
            }
        } catch {
            print("[CookbookView] unsave failed: \(error)")
        }
    }
}

// MARK: - Full Screen Preview

/// Bottom-anchored recipe preview that slides up, covering 90% of the screen.
struct CookbookFullScreenPreview: View {
    let preview: CookbookEntryItem
    var onOpenRecipe: () -> Void
    var onDismiss: () -> Void

    @State private var dragOffset: CGFloat = 0
    private let dismissThreshold: CGFloat = 120

    var body: some View {
        GeometryReader { geo in
            let panelHeight = geo.size.height * 0.90

            ZStack {
                Color.black.opacity(0.4)
                    .ignoresSafeArea()
                    .onTapGesture { onDismiss() }

                VStack {
                    Spacer()

                    ZStack(alignment: .top) {
                        LazyImage(url: preview.resolvedImageURL) { state in
                            if let image = state.image {
                                image
                                    .resizable()
                                    .aspectRatio(contentMode: .fill)
                            } else {
                                Rectangle().fill(AlchemyColors.surfaceSecondary)
                            }
                        }
                        .frame(width: geo.size.width, height: panelHeight)
                        .clipped()

                        Color.black.opacity(0.55)

                        VStack(spacing: AlchemySpacing.lg) {
                            RoundedRectangle(cornerRadius: 2.5)
                                .fill(.white.opacity(0.5))
                                .frame(width: 36, height: 5)
                                .padding(.top, AlchemySpacing.md)

                            Spacer()

                            VStack(spacing: AlchemySpacing.sm) {
                                Text(preview.title)
                                    .font(AlchemyTypography.displayLarge)
                                    .foregroundStyle(.white)
                                    .multilineTextAlignment(.center)
                                    .lineLimit(3)
                                    .shadow(color: .black.opacity(0.5), radius: 8, x: 0, y: 2)

                                Text(preview.summary)
                                    .font(AlchemyTypography.body)
                                    .foregroundStyle(.white.opacity(0.85))
                                    .multilineTextAlignment(.center)
                                    .lineLimit(3)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            .padding(.horizontal, AlchemySpacing.xl + AlchemySpacing.sm)

                            if let stats = preview.quickStats {
                                HStack(spacing: AlchemySpacing.xxl) {
                                    CompactGauge.time(minutes: stats.timeMinutes)
                                    CompactGauge.difficulty(stats.difficultyNormalized)
                                    CompactGauge.health(stats.healthNormalized)
                                    CompactGauge.ingredients(count: stats.items)
                                }
                                .padding(.top, AlchemySpacing.md)
                            }

                            Spacer()
                                .frame(height: AlchemySpacing.md)

                            Button {
                                onOpenRecipe()
                            } label: {
                                Text("Open Recipe")
                                    .font(AlchemyTypography.subheading)
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, AlchemySpacing.xxl)
                                    .padding(.vertical, AlchemySpacing.md)
                            }
                            .glassEffect(.regular, in: .capsule)

                            Spacer()
                                .frame(height: AlchemySpacing.xxxl + AlchemySpacing.xl)
                        }
                        .frame(height: panelHeight)
                    }
                    .frame(height: panelHeight)
                    .clipShape(
                        UnevenRoundedRectangle(
                            topLeadingRadius: 24,
                            bottomLeadingRadius: 0,
                            bottomTrailingRadius: 0,
                            topTrailingRadius: 24
                        )
                    )
                    .offset(y: max(dragOffset, 0))
                    .gesture(
                        DragGesture()
                            .onChanged { value in
                                dragOffset = value.translation.height
                            }
                            .onEnded { value in
                                if value.translation.height > dismissThreshold {
                                    onDismiss()
                                } else {
                                    withAnimation(.spring(duration: 0.3)) {
                                        dragOffset = 0
                                    }
                                }
                            }
                    )
                }
                .ignoresSafeArea(edges: .bottom)
            }
        }
    }
}

// MARK: - CookbookEntryItem → RecipeCard Conversion

extension CookbookEntryItem {
    /// Converts a cookbook entry to the UI RecipeCard model for
    /// compatibility with RecipeCardView and other existing components.
    var asRecipeCard: RecipeCard {
        RecipeCard(
            id: canonicalRecipeId,
            title: title,
            summary: summary,
            category: category,
            imageURL: resolvedImageURL,
            imageStatus: ImageStatus(rawValue: imageStatus) ?? .pending,
            updatedAt: ISO8601DateFormatter().date(from: updatedAt) ?? .now,
            cookTimeMinutes: quickStats?.timeMinutes ?? 30,
            difficulty: quickStats?.difficultyNormalized ?? 0.5,
            healthScore: quickStats?.healthNormalized ?? 0.5,
            ingredientCount: quickStats?.items ?? 8
        )
    }
}

// MARK: - RecipePreview → RecipeCard Conversion (Explore/Search)

extension RecipePreview {
    /// Converts an API RecipePreview to the UI RecipeCard model for
    /// compatibility with RecipeCardView in Explore/Search contexts.
    var asRecipeCard: RecipeCard {
        RecipeCard(
            id: id,
            title: title,
            summary: summary,
            category: category,
            imageURL: resolvedImageURL,
            imageStatus: ImageStatus(rawValue: imageStatus) ?? .pending,
            updatedAt: ISO8601DateFormatter().date(from: updatedAt) ?? .now,
            cookTimeMinutes: quickStats?.timeMinutes ?? 30,
            difficulty: quickStats?.difficultyNormalized ?? 0.5,
            healthScore: quickStats?.healthNormalized ?? 0.5,
            ingredientCount: quickStats?.items ?? 8
        )
    }
}
