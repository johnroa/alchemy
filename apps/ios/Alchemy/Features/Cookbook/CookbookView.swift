import SwiftUI
import NukeUI

/// Cookbook screen — saved recipes displayed in a staggered masonry 2-column grid.
///
/// Data source: GET /recipes/cookbook. Falls back to empty state when no
/// recipes are saved. Supports pull-to-refresh and client-side filtering
/// by category and search text.
struct CookbookView: View {
    @State private var previews: [RecipePreview] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var selectedPreview: RecipePreview?
    @State private var navigateToRecipeId: String?
    @State private var showPreferences = false
    @State private var showSettings = false
    @State private var searchText = ""
    @State private var selectedFilter = "All"
    @State private var showFullScreenPreview = false

    /// Unique categories derived from the loaded cookbook items.
    private var categories: [String] {
        let unique = Set(previews.map(\.category))
        return ["All"] + unique.sorted()
    }

    /// Filtered previews based on selected category and search text.
    private var filteredPreviews: [RecipePreview] {
        previews.filter { preview in
            let matchesFilter = selectedFilter == "All" || preview.category == selectedFilter
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
                            filterChips
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

    private func cardCell(_ preview: RecipePreview) -> some View {
        RecipeCardView(card: preview.asRecipeCard)
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
                    // Edit — will navigate to generate with recipe loaded
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

    // MARK: - Empty / Error States

    private var emptyView: some View {
        VStack(spacing: AlchemySpacing.md) {
            Image(systemName: "book.closed")
                .font(.system(size: 48))
                .foregroundStyle(AlchemyColors.textTertiary)
            Text("No recipes yet")
                .font(AlchemyTypography.subheading)
                .foregroundStyle(AlchemyColors.textSecondary)
            Text("Generate your first recipe to get started.")
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
    let preview: RecipePreview
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

// MARK: - RecipePreview → RecipeCard Conversion

extension RecipePreview {
    /// Converts an API RecipePreview to the UI RecipeCard model for
    /// compatibility with RecipeCardView and other existing components.
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
