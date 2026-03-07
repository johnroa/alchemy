import SwiftUI
import NukeUI

/// Explore screen — TikTok/Reels-style vertical discovery feed.
///
/// Powered by POST /recipes/search. When both query and preset_id are empty,
/// the API returns an Explore feed. Filters and search text are sent as query
/// or preset_id to get filtered results. Results paginate via cursor.
///
/// Architecture: two-layer ZStack.
///   Layer 1 (back): Full-screen paging ScrollView with containerRelativeFrame.
///   Layer 2 (front): Floating header, filters, context label, search bar.
struct ExploreView: View {
    @State private var previews: [RecipePreview] = []
    @State private var selectedFilter = "All"
    @State private var selectedSort: ExploreSortMode = .recent
    @State private var searchText = ""
    @State private var selectedRecipeId: String?
    @State private var showPreferences = false
    @State private var showSettings = false
    @State private var isLoading = false
    @State private var contextLabel = "Exploring all recipes"
    @State private var nextCursor: String?
    @State private var searchId: String?
    @State private var trendingIngredients: [IngredientTrendingStat] = []

    private let filters = PreviewData.exploreFilters

    var body: some View {
        NavigationStack {
            ZStack {
                // LAYER 1: Full-screen paging feed
                ScrollView(.vertical) {
                    LazyVStack(spacing: 0) {
                        ForEach(previews) { preview in
                            ExploreCardView(preview: preview) {
                                selectedRecipeId = preview.id
                            }
                            .containerRelativeFrame([.horizontal, .vertical])
                            .onAppear {
                                // Infinite scroll: load more when near the end
                                if preview.id == previews.last?.id {
                                    Task { await loadMore() }
                                }
                            }
                        }

                        if previews.isEmpty && !isLoading {
                            emptyFeedView
                                .containerRelativeFrame([.horizontal, .vertical])
                        }
                    }
                    .scrollTargetLayout()
                }
                .scrollTargetBehavior(.paging)
                .scrollIndicators(.hidden)
                .ignoresSafeArea()

                // LAYER 2: Floating overlay UI
                VStack(spacing: 0) {
                    VStack(spacing: 0) {
                        HStack {
                            Text("Explore")
                                .font(AlchemyTypography.heading)
                                .foregroundStyle(.white)
                                .shadow(color: .black.opacity(0.5), radius: 4)
                            Spacer()
                            sortPicker
                            ImportMenu()
                            ProfileMenu(
                                onPreferences: { showPreferences = true },
                                onSettings: { showSettings = true }
                            )
                        }
                        .padding(.horizontal, AlchemySpacing.screenHorizontal)
                        .padding(.vertical, AlchemySpacing.md)

                        filterChips

                        HStack(spacing: AlchemySpacing.xs) {
                            if isLoading {
                                ProgressView()
                                    .tint(.white.opacity(0.7))
                                    .scaleEffect(0.7)
                            }
                            Text(contextLabel)
                                .font(AlchemyTypography.caption)
                                .foregroundStyle(.white.opacity(0.7))
                                .italic()
                                .shadow(color: .black.opacity(0.5), radius: 4)
                        }
                        .padding(.top, AlchemySpacing.sm)
                        .padding(.bottom, AlchemySpacing.md)
                    }
                    .background(
                        LinearGradient(
                            colors: [.black.opacity(0.75), .black.opacity(0.5), .clear],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                        .ignoresSafeArea(edges: .top)
                    )

                    Spacer()

                    GlassInputBar(
                        placeholder: "Search for inspiration...",
                        text: $searchText,
                        onSubmit: { applySearch() }
                    )
                    .padding(.bottom, AlchemySpacing.md)
                }
            }
            .background(AlchemyColors.background)
            .navigationBarHidden(true)
            .navigationDestination(item: $selectedRecipeId) { recipeId in
                RecipeDetailView(recipeId: recipeId, showAddToCookbook: true)
            }
            .sheet(isPresented: $showPreferences) { PreferencesView() }
            .sheet(isPresented: $showSettings) { SettingsView() }
            .task {
                await loadFeed()
                await loadTrendingIngredients()
            }
        }
    }

    // MARK: - Sort Picker

    private var sortPicker: some View {
        Menu {
            ForEach(ExploreSortMode.allCases) { mode in
                Button {
                    guard selectedSort != mode else { return }
                    selectedSort = mode
                    Task { await loadFeed(sortMode: mode) }
                } label: {
                    Label(mode.label, systemImage: mode.icon)
                    if selectedSort == mode {
                        Image(systemName: "checkmark")
                    }
                }
            }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: selectedSort.icon)
                    .font(.system(size: 14, weight: .semibold))
                Text(selectedSort.shortLabel)
                    .font(.system(size: 14, weight: .semibold))
            }
            .foregroundStyle(.white.opacity(0.85))
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(.ultraThinMaterial, in: Capsule())
        }
    }

    // MARK: - Filter Labels

    private var filterChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: AlchemySpacing.lg) {
                ForEach(filters, id: \.self) { filter in
                    Button {
                        guard selectedFilter != filter else { return }
                        withAnimation(.easeInOut(duration: 0.2)) {
                            selectedFilter = filter
                            searchText = ""
                        }
                        Task {
                            await loadFeed(
                                preset: filter == "All" ? nil : filter,
                                context: filter == "All"
                                    ? "Exploring all recipes"
                                    : "Exploring \(filter.lowercased()) recipes"
                            )
                        }
                    } label: {
                        Text(filter)
                            .font(.system(size: 18, weight: selectedFilter == filter ? .bold : .regular))
                            .foregroundStyle(.white.opacity(selectedFilter == filter ? 1.0 : 0.5))
                            .shadow(color: .black.opacity(0.4), radius: 3)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, AlchemySpacing.screenHorizontal)
            .padding(.vertical, AlchemySpacing.sm)
        }
    }

    private var emptyFeedView: some View {
        VStack(spacing: AlchemySpacing.md) {
            Image(systemName: "sparkles")
                .font(.system(size: 48))
                .foregroundStyle(.white.opacity(0.4))
            Text("No recipes found")
                .font(AlchemyTypography.subheading)
                .foregroundStyle(.white.opacity(0.7))
            Text("Try a different filter or search term.")
                .font(AlchemyTypography.body)
                .foregroundStyle(.white.opacity(0.5))
        }
    }

    // MARK: - API

    private func applySearch() {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return }
        withAnimation { selectedFilter = "" }
        Task {
            await loadFeed(
                query: query,
                context: "Exploring \(query.lowercased())..."
            )
        }
    }

    /// Loads the explore feed from POST /recipes/search.
    /// When no query or preset is provided, returns the default explore feed.
    /// sortMode controls ordering: recent (default), popular, or trending.
    private func loadFeed(
        query: String? = nil,
        preset: String? = nil,
        context: String = "Exploring all recipes",
        sortMode: ExploreSortMode? = nil
    ) async {
        isLoading = true
        let effectiveSort = sortMode ?? selectedSort
        contextLabel = effectiveSort == .recent
            ? context
            : "\(effectiveSort.label) recipes"
        nextCursor = nil

        do {
            let response: RecipeSearchResponse = try await APIClient.shared.request(
                "/recipes/search",
                method: .post,
                body: RecipeSearchRequest(
                    query: query,
                    presetId: preset,
                    cursor: nil,
                    limit: 10,
                    sortBy: effectiveSort.rawValue
                )
            )

            withAnimation {
                previews = response.items
                nextCursor = response.nextCursor
                searchId = response.searchId
                isLoading = false
            }

            if let noMatch = response.noMatch {
                contextLabel = noMatch.message
            }
        } catch {
            withAnimation { isLoading = false }
            print("[ExploreView] loadFeed error: \(error)")
        }
    }

    /// Loads the next page of results using the cursor from the previous response.
    private func loadMore() async {
        guard let cursor = nextCursor, !isLoading else { return }

        do {
            let response: RecipeSearchResponse = try await APIClient.shared.request(
                "/recipes/search",
                method: .post,
                body: RecipeSearchRequest(
                    query: nil,
                    presetId: nil,
                    cursor: cursor,
                    limit: 10,
                    sortBy: selectedSort.rawValue
                )
            )

            withAnimation {
                previews.append(contentsOf: response.items)
                nextCursor = response.nextCursor
            }
        } catch {
            print("[ExploreView] loadMore error: \(error)")
        }
    }

    /// Fetches trending ingredient stats for the trending section.
    private func loadTrendingIngredients() async {
        do {
            let response: IngredientTrendingResponse = try await APIClient.shared.request(
                "/ingredients/trending?limit=10",
                method: .get
            )
            withAnimation { trendingIngredients = response.items }
        } catch {
            print("[ExploreView] loadTrendingIngredients error: \(error)")
        }
    }
}

// MARK: - Sort Mode

/// Explore feed sort options. Maps to the API's sort_by parameter.
enum ExploreSortMode: String, CaseIterable, Identifiable {
    case recent
    case popular
    case trending

    var id: String { rawValue }

    var label: String {
        switch self {
        case .recent: return "New"
        case .popular: return "Popular"
        case .trending: return "Trending"
        }
    }

    var shortLabel: String { label }

    var icon: String {
        switch self {
        case .recent: return "clock"
        case .popular: return "heart.fill"
        case .trending: return "flame.fill"
        }
    }
}

// MARK: - Explore Card

/// Full-bleed hero card filling one "page" of the paging scroll.
/// Uses RecipePreview from the API instead of the local RecipeCard model.
private struct ExploreCardView: View {
    let preview: RecipePreview
    let onTap: () -> Void

    var body: some View {
        ZStack {
            Color.clear
                .overlay {
                    LazyImage(url: preview.resolvedImageURL) { state in
                        if let image = state.image {
                            image
                                .resizable()
                                .aspectRatio(contentMode: .fill)
                        } else if state.error != nil {
                            AlchemyColors.surfaceSecondary
                        } else {
                            AlchemyColors.surfaceSecondary
                                .overlay { ProgressView().tint(.white.opacity(0.3)) }
                        }
                    }
                }
                .clipped()

            Color.black.opacity(0.25)

            LinearGradient(
                colors: [.clear, .clear, .black.opacity(0.8)],
                startPoint: .top,
                endPoint: .bottom
            )

            VStack {
                Spacer()

                HStack(alignment: .bottom, spacing: AlchemySpacing.md) {
                    VStack(alignment: .leading, spacing: AlchemySpacing.sm) {
                        Text(preview.title)
                            .font(AlchemyTypography.displayLarge)
                            .foregroundStyle(.white)
                            .shadow(color: .black.opacity(0.5), radius: 6, x: 0, y: 2)

                        Text(preview.summary)
                            .font(AlchemyTypography.body)
                            .foregroundStyle(.white.opacity(0.85))
                            .lineLimit(2)
                            .shadow(color: .black.opacity(0.3), radius: 4, x: 0, y: 1)

                        if let socialProof = preview.socialProofText {
                            HStack(spacing: AlchemySpacing.xs) {
                                Image(systemName: "person.2.fill")
                                    .font(.system(size: 11))
                                Text(socialProof)
                                    .font(.system(size: 13, weight: .medium))
                            }
                            .foregroundStyle(.white.opacity(0.65))
                            .shadow(color: .black.opacity(0.3), radius: 3)
                        }
                    }

                    Spacer(minLength: 0)

                    ExploreRail(preview: preview)
                }
                .padding(.horizontal, AlchemySpacing.screenHorizontal)
                .padding(.bottom, 180)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture { onTap() }
    }
}
