import SwiftUI
import NukeUI

/// Explore screen — TikTok/Reels-style vertical discovery feed.
///
/// Powered by POST /recipes/explore/for-you for the default personalized feed
/// and POST /recipes/search for explicit text search only.
///
/// Architecture: two-layer ZStack.
///   Layer 1 (back): Full-screen paging ScrollView with containerRelativeFrame.
///   Layer 2 (front): Floating header, filters, context label, search bar.
struct ExploreView: View {
    @State private var previews: [RecipePreview] = []
    @State private var suggestedChips: [SuggestedChip] = []
    @State private var selectedChipId: String?
    @State private var searchText = ""
    @State private var selectedRecipeId: String?
    @State private var showPreferences = false
    @State private var showSettings = false
    @State private var isLoading = false
    @State private var contextLabel = "Personalized for you"
    @State private var nextCursor: String?
    @State private var feedSessionId = UUID().uuidString
    @State private var feedAlgorithmVersion: String?
    @State private var feedProfileState: String?
    @State private var isSearchMode = false
    @State private var activeFeedChipId: String?
    @State private var activeFeedIsSearchMode = false
    @State private var seenImpressionKeys: Set<String> = []
    @State private var openedImpressionKeys: Set<String> = []
    @State private var skippedImpressionKeys: Set<String> = []
    var body: some View {
        NavigationStack {
            ZStack {
                // LAYER 1: Full-screen paging feed
                ScrollView(.vertical) {
                    LazyVStack(spacing: 0) {
                        ForEach(Array(previews.enumerated()), id: \.element.id) { index, preview in
                            ExploreCardView(preview: preview) {
                                trackExploreOpen(preview: preview, rank: index)
                                selectedRecipeId = preview.id
                            }
                            .containerRelativeFrame([.horizontal, .vertical])
                            .onAppear {
                                trackExploreImpression(preview: preview, rank: index)
                                // Infinite scroll: load more when near the end
                                if preview.id == previews.last?.id {
                                    Task { await loadMore() }
                                }
                            }
                            .onDisappear {
                                trackExploreSkip(preview: preview, rank: index)
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
                RecipeDetailView(
                    recipeId: recipeId,
                    sourceSurface: "explore",
                    sourceSessionId: feedSessionId,
                    algorithmVersion: feedAlgorithmVersion,
                    showAddToCookbook: true
                )
            }
            .sheet(isPresented: $showPreferences) { PreferencesView() }
            .sheet(isPresented: $showSettings) { SettingsView() }
            .task {
                await loadForYouFeed()
            }
        }
    }

    // MARK: - Filter Labels

    private var filterChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: AlchemySpacing.lg) {
                Button {
                    guard selectedChipId != nil else { return }
                    withAnimation(.easeInOut(duration: 0.2)) {
                        selectedChipId = nil
                        searchText = ""
                    }
                    BehaviorTelemetry.shared.track(
                        eventType: "explore_chip_applied",
                        surface: "explore",
                        sessionId: feedSessionId,
                        payload: [
                            "chip_id": .null,
                            "chip_label": .string("For You"),
                            "selected": .bool(true),
                        ]
                    )
                    Task {
                        await loadForYouFeed(
                            chipId: nil,
                            chipLabel: nil,
                            context: "Personalized for you"
                        )
                    }
                } label: {
                    Text("For You")
                        .font(.system(size: 18, weight: selectedChipId == nil ? .bold : .regular))
                        .foregroundStyle(.white.opacity(selectedChipId == nil ? 1.0 : 0.5))
                        .shadow(color: .black.opacity(0.4), radius: 3)
                }
                .buttonStyle(.plain)

                ForEach(suggestedChips) { chip in
                    let isSelected = selectedChipId == chip.id
                    Button {
                        guard !isSelected else { return }
                        withAnimation(.easeInOut(duration: 0.2)) {
                            selectedChipId = chip.id
                            searchText = ""
                        }
                        BehaviorTelemetry.shared.track(
                            eventType: "explore_chip_applied",
                            surface: "explore",
                            sessionId: feedSessionId,
                            payload: [
                                "chip_id": .string(chip.id),
                                "chip_label": .string(chip.label),
                                "selected": .bool(true),
                            ]
                        )
                        Task {
                            await loadForYouFeed(
                                chipId: chip.id,
                                chipLabel: chip.label,
                                context: "Personalized around \(chip.label.lowercased())"
                            )
                        }
                    } label: {
                        Text(chip.label)
                            .font(.system(size: 18, weight: isSelected ? .bold : .regular))
                            .foregroundStyle(.white.opacity(isSelected ? 1.0 : 0.5))
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
        withAnimation { selectedChipId = nil }
        Task {
            await loadSearchFeed(
                query: query,
                context: "Exploring \(query.lowercased())..."
            )
        }
    }

    private func resetFeedTracking() {
        seenImpressionKeys = []
        openedImpressionKeys = []
        skippedImpressionKeys = []
    }

    private func loadForYouFeed(
        chipId: String? = nil,
        chipLabel: String? = nil,
        context: String = "Personalized for you"
    ) async {
        isSearchMode = false
        contextLabel = context
        nextCursor = nil

        if let cached = ExploreFeedPreloader.shared.cachedResponse(for: chipId) {
            applyForYouResponse(cached, chipId: chipId)
            contextLabel = context
            ExploreFeedPreloader.shared.preload(chipId: chipId, force: true)
            return
        }

        isLoading = true

        do {
            let response = try await ExploreFeedPreloader.shared.load(chipId: chipId)
            applyForYouResponse(response, chipId: chipId)
            if chipLabel == nil && chipId != nil {
                contextLabel = "Personalized around this theme"
            }

            if let noMatch = response.noMatch {
                contextLabel = noMatch.message
            }
        } catch {
            withAnimation { isLoading = false }
            print("[ExploreView] loadForYouFeed error: \(error)")
        }
    }

    private func applyForYouResponse(_ response: ForYouFeedResponse, chipId: String?) {
        withAnimation {
            previews = response.items
            suggestedChips = response.suggestedChips
            selectedChipId = chipId
            nextCursor = response.nextCursor
            feedSessionId = response.feedId
            feedAlgorithmVersion = response.algorithmVersion
            feedProfileState = response.profileState
            activeFeedChipId = chipId
            activeFeedIsSearchMode = false
            resetFeedTracking()
            isLoading = false
        }
    }

    private func loadSearchFeed(
        query: String,
        context: String
    ) async {
        isLoading = true
        isSearchMode = true
        contextLabel = context
        nextCursor = nil

        do {
            let response: RecipeSearchResponse = try await APIClient.shared.request(
                "/recipes/search",
                method: .post,
                body: RecipeSearchRequest(
                    query: query,
                    presetId: nil,
                    cursor: nil,
                    limit: 10,
                    sortBy: nil
                )
            )

            withAnimation {
                previews = response.items
                nextCursor = response.nextCursor
                feedSessionId = response.searchId
                feedAlgorithmVersion = nil
                feedProfileState = nil
                activeFeedChipId = nil
                activeFeedIsSearchMode = true
                resetFeedTracking()
                isLoading = false
            }

            if let noMatch = response.noMatch {
                contextLabel = noMatch.message
            }
        } catch {
            withAnimation { isLoading = false }
            print("[ExploreView] loadSearchFeed error: \(error)")
        }
    }

    /// Loads the next page of results using the cursor from the previous response.
    private func loadMore() async {
        guard let cursor = nextCursor, !isLoading else { return }

        do {
            if activeFeedIsSearchMode {
                let response: RecipeSearchResponse = try await APIClient.shared.request(
                    "/recipes/search",
                    method: .post,
                    body: RecipeSearchRequest(
                        query: nil,
                        presetId: nil,
                        cursor: cursor,
                        limit: 10,
                        sortBy: nil
                    )
                )

                withAnimation {
                    previews.append(contentsOf: response.items)
                    nextCursor = response.nextCursor
                    feedSessionId = response.searchId
                    activeFeedChipId = nil
                    activeFeedIsSearchMode = true
                }
            } else {
                let response: ForYouFeedResponse = try await APIClient.shared.request(
                    "/recipes/explore/for-you",
                    method: .post,
                    body: ForYouFeedRequest(
                        cursor: cursor,
                        limit: 10,
                        presetId: nil,
                        chipId: activeFeedChipId
                    )
                )

                withAnimation {
                    previews.append(contentsOf: response.items)
                    suggestedChips = response.suggestedChips
                    nextCursor = response.nextCursor
                    feedSessionId = response.feedId
                    feedAlgorithmVersion = response.algorithmVersion
                    feedProfileState = response.profileState
                    activeFeedIsSearchMode = false
                }
            }
        } catch {
            print("[ExploreView] loadMore error: \(error)")
        }
    }

    private func feedFilterValue() -> String {
        if activeFeedIsSearchMode {
            return "search"
        }
        return activeFeedChipId ?? "for_you"
    }

    private func trackExploreImpression(preview: RecipePreview, rank: Int) {
        let key = "\(feedSessionId)::\(preview.id)"
        guard seenImpressionKeys.insert(key).inserted else { return }

        let whyTags = preview.whyTags ?? []
        BehaviorTelemetry.shared.track(
            eventType: "explore_impression",
            surface: "explore",
            sessionId: feedSessionId,
            entityType: "recipe",
            entityId: preview.id,
            algorithmVersion: feedAlgorithmVersion,
            payload: [
                "rank": .int(rank),
                "filter": .string(feedFilterValue()),
                "preset_id": activeFeedChipId.map(AnyCodableValue.string) ?? .null,
                "chip_id": activeFeedChipId.map(AnyCodableValue.string) ?? .null,
                "profile_state": feedProfileState.map(AnyCodableValue.string) ?? .null,
                "applied_context": .string(activeFeedIsSearchMode ? "query" : (activeFeedChipId == nil ? "for_you" : "preset")),
                "has_query": .bool(!searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty),
                "save_count": preview.saveCount.map(AnyCodableValue.int) ?? .null,
                "variant_count": preview.variantCount.map(AnyCodableValue.int) ?? .null,
                "why_tag_1": whyTags.first.map(AnyCodableValue.string) ?? .null,
                "why_tag_2": whyTags.dropFirst().first.map(AnyCodableValue.string) ?? .null,
            ]
        )
    }

    private func trackExploreOpen(preview: RecipePreview, rank: Int) {
        let key = "\(feedSessionId)::\(preview.id)"
        openedImpressionKeys.insert(key)

        BehaviorTelemetry.shared.track(
            eventType: "explore_opened_recipe",
            surface: "explore",
            sessionId: feedSessionId,
            entityType: "recipe",
            entityId: preview.id,
            algorithmVersion: feedAlgorithmVersion,
            payload: [
                "rank": .int(rank),
                "filter": .string(feedFilterValue()),
                "preset_id": activeFeedChipId.map(AnyCodableValue.string) ?? .null,
                "chip_id": activeFeedChipId.map(AnyCodableValue.string) ?? .null,
                "profile_state": feedProfileState.map(AnyCodableValue.string) ?? .null,
            ]
        )
    }

    private func trackExploreSkip(preview: RecipePreview, rank: Int) {
        let key = "\(feedSessionId)::\(preview.id)"
        guard seenImpressionKeys.contains(key) else { return }
        guard !openedImpressionKeys.contains(key) else { return }
        guard skippedImpressionKeys.insert(key).inserted else { return }

        BehaviorTelemetry.shared.track(
            eventType: "explore_skipped_recipe",
            surface: "explore",
            sessionId: feedSessionId,
            entityType: "recipe",
            entityId: preview.id,
            algorithmVersion: feedAlgorithmVersion,
            payload: [
                "rank": .int(rank),
                "filter": .string(feedFilterValue()),
                "preset_id": activeFeedChipId.map(AnyCodableValue.string) ?? .null,
                "chip_id": activeFeedChipId.map(AnyCodableValue.string) ?? .null,
                "profile_state": feedProfileState.map(AnyCodableValue.string) ?? .null,
            ]
        )
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

                        if let whyTags = preview.whyTags, !whyTags.isEmpty {
                            HStack(spacing: AlchemySpacing.xs) {
                                ForEach(Array(whyTags.prefix(2)), id: \.self) { tag in
                                    Text(tag)
                                        .font(.system(size: 12, weight: .semibold))
                                        .foregroundStyle(.white.opacity(0.92))
                                        .padding(.horizontal, 10)
                                        .padding(.vertical, 6)
                                        .background(.ultraThinMaterial, in: Capsule())
                                }
                            }
                        }

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
