import SwiftUI

/// Cookbook screen — saved recipes displayed in a staggered masonry 2-column grid.
///
/// Data source: GET /recipes/cookbook. Falls back to empty state when no
/// recipes are saved. Supports pull-to-refresh, intelligent horizontal
/// filter chips (derived from actual cookbook content), and text search.
struct CookbookView: View {
    /// When non-nil, a recipe is being saved in the background.
    /// Shows a skeleton card at the top of the grid. Cleared by
    /// GenerateView when the commit API finishes.
    @Binding var pendingSave: PendingSave?

    @State private var previews: [CookbookEntryItem] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var selectedPreview: CookbookEntryItem?
    @State private var navigateToRecipeId: String?
    @State private var showPreferences = false
    @State private var showSettings = false
    @State private var searchText = ""
    @State private var showFullScreenPreview = false
    @State private var cookbookSessionId = UUID().uuidString
    @State private var lastCookbookViewTrackedAt: Date?
    @State private var suggestedChips: [SuggestedChip] = []
    @State private var staleContext: StaleContext?
    @State private var showStaleReview = false
    @State private var staleBannerDismissed = false

    /// Holds the pending-save info locally after the binding clears, so the
    /// skeleton card stays visible until loadCookbook() actually returns
    /// fresh data (eliminates the disappear-then-reappear flash).
    @State private var holdoverSave: PendingSave?

    /// The skeleton card to display: the real binding while the commit is
    /// in flight, then the local holdover copy until fresh data arrives.
    private var effectivePendingSave: PendingSave? {
        pendingSave ?? holdoverSave
    }

    // MARK: - Smart Filter State

    private static let newChipId = "__new__"
    /// Recipes saved within this window qualify as "new".
    private static let newRecencyWindow: TimeInterval = 7 * 24 * 60 * 60

    /// Currently selected filter chip. nil = "All".
    @State private var activeFilter: SuggestedChip?

    /// Filtered previews based on the active chip and search text.
    private var filteredPreviews: [CookbookEntryItem] {
        previews.filter { entry in
            let matchesSearch = searchText.isEmpty
                || entry.title.localizedCaseInsensitiveContains(searchText)
                || entry.summary.localizedCaseInsensitiveContains(searchText)

            let matchesChip: Bool
            if let filter = activeFilter {
                if filter.id == Self.newChipId {
                    let cutoff = Date().addingTimeInterval(-Self.newRecencyWindow)
                    let savedDate = ISO8601DateFormatter().date(from: entry.savedAt) ?? .distantPast
                    matchesChip = savedDate >= cutoff
                } else {
                    matchesChip = entry.matchedChipIds.contains(filter.id)
                }
            } else {
                matchesChip = true
            }

            return matchesSearch && matchesChip
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                headerBar

                if isLoading && previews.isEmpty && effectivePendingSave == nil {
                    AlchemyLoadingIndicator()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .offset(y: -30)
                } else if let errorMessage, previews.isEmpty, effectivePendingSave == nil {
                    Spacer()
                    errorView(errorMessage)
                    Spacer()
                } else if previews.isEmpty && effectivePendingSave == nil {
                    Spacer()
                    emptyView
                    Spacer()
                } else {
                    ScrollView {
                        VStack(spacing: AlchemySpacing.md) {
                            cookbookSearchBar
                            if !suggestedChips.isEmpty {
                                smartFilterChips
                            }
                            if let ctx = staleContext, !staleBannerDismissed {
                                staleVariantBanner(ctx)
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
                            BehaviorTelemetry.shared.track(
                                eventType: "cookbook_recipe_opened",
                                surface: "cookbook",
                                sessionId: cookbookSessionId,
                                entityType: "cookbook_entry",
                                entityId: preview.id,
                                payload: [
                                    "variant_status": .string(preview.variantStatus),
                                ]
                            )
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
                RecipeDetailView(
                    cookbookEntryId: recipeId,
                    sourceSurface: "cookbook",
                    sourceSessionId: cookbookSessionId
                )
            }
            .sheet(isPresented: $showPreferences) {
                PreferencesView()
            }
            .sheet(isPresented: $showSettings) {
                SettingsView()
            }
            .sheet(isPresented: $showStaleReview) {
                if let ctx = staleContext {
                    StaleVariantReviewSheet(
                        context: ctx,
                        recipes: previews.filter { ctx.staleRecipeIds.contains($0.id) },
                        onComplete: {
                            showStaleReview = false
                            Task { await loadCookbook() }
                        }
                    )
                }
            }
            .toolbarVisibility(showFullScreenPreview ? .hidden : .automatic, for: .tabBar)
            .onAppear {
                // Skip when a save is in flight — the onChange handler
                // owns that refresh cycle.
                guard pendingSave == nil else { return }
                Task { await loadCookbook() }
            }
            .onChange(of: pendingSave) { old, new in
                // When the background commit finishes, pendingSave goes
                // from non-nil to nil. Keep the skeleton visible via
                // holdoverSave while we refresh, so there's no flash.
                if old != nil && new == nil {
                    holdoverSave = old
                    Task {
                        await loadCookbook()
                        withAnimation(.easeInOut(duration: 0.3)) {
                            holdoverSave = nil
                        }
                    }
                }
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

            ImportMenu()

            ProfileMenu(
                onPreferences: { showPreferences = true },
                onSettings: { showSettings = true }
            )
        }
        .padding(.horizontal, AlchemySpacing.screenHorizontal)
        .padding(.vertical, AlchemySpacing.md)
    }

    // MARK: - Search Bar

    private var cookbookSearchBar: some View {
        HStack(spacing: AlchemySpacing.sm) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(AlchemyColors.textTertiary)

            TextField("Search recipes...", text: $searchText)
                .font(AlchemyTypography.body)
                .foregroundStyle(AlchemyColors.textPrimary)
                .submitLabel(.search)
                .onSubmit {
                    let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !query.isEmpty else { return }
                    BehaviorTelemetry.shared.track(
                        eventType: "cookbook_search_applied",
                        surface: "cookbook",
                        sessionId: cookbookSessionId,
                        payload: [
                            "query_length": .int(query.count),
                            "active_filter": activeFilter.map { .string($0.label) } ?? .null,
                        ]
                    )
                }

            if !searchText.isEmpty {
                Button {
                    searchText = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(AlchemyColors.textTertiary)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, AlchemySpacing.md)
        .padding(.vertical, AlchemySpacing.sm + 2)
        .background(AlchemyColors.surface)
        .clipShape(RoundedRectangle(cornerRadius: AlchemySpacing.buttonRadius))
        .padding(.horizontal, AlchemySpacing.screenHorizontal)
    }

    // MARK: - Smart Filter Chips

    /// Horizontal scroll strip of intelligently derived filter chips.
    /// Matches the Explore page style: clean white text labels, bold when
    /// selected, dimmed when inactive. No backgrounds or icons.
    private static let newChip = SuggestedChip(id: newChipId, label: "New", matchedCount: 0)

    private var smartFilterChips: some View {
        let allChips = [Self.newChip] + suggestedChips

        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: AlchemySpacing.lg) {
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) { activeFilter = nil }
                    BehaviorTelemetry.shared.track(
                        eventType: "cookbook_chip_applied",
                        surface: "cookbook",
                        sessionId: cookbookSessionId,
                        payload: [
                            "chip": .string("All"),
                            "chip_id": .null,
                        ]
                    )
                } label: {
                    Text("ALL")
                        .font(.system(size: 14, weight: activeFilter == nil ? .bold : .regular))
                        .tracking(0.15)
                        .foregroundStyle(AlchemyColors.textPrimary.opacity(activeFilter == nil ? 1.0 : 0.4))
                }
                .buttonStyle(.plain)

                ForEach(allChips) { chip in
                    let isSelected = activeFilter?.id == chip.id
                    Button {
                        withAnimation(.easeInOut(duration: 0.2)) {
                            activeFilter = isSelected ? nil : chip
                        }
                        BehaviorTelemetry.shared.track(
                            eventType: "cookbook_chip_applied",
                            surface: "cookbook",
                            sessionId: cookbookSessionId,
                            payload: [
                                "chip": .string(chip.label),
                                "chip_id": .string(chip.id),
                                "selected": .bool(!isSelected),
                            ]
                        )
                    } label: {
                        Text(chip.label.uppercased())
                            .font(.system(size: 14, weight: isSelected ? .bold : .regular))
                            .tracking(0.15)
                            .foregroundStyle(AlchemyColors.textPrimary.opacity(isSelected ? 1.0 : 0.4))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, AlchemySpacing.screenHorizontal)
            .padding(.vertical, AlchemySpacing.sm)
        }
    }

    // MARK: - Masonry Grid

    private var masonryGrid: some View {
        let cards = filteredPreviews
        let leftCards = cards.enumerated().filter { $0.offset % 2 == 0 }.map(\.element)
        let rightCards = cards.enumerated().filter { $0.offset % 2 != 0 }.map(\.element)

        return HStack(alignment: .top, spacing: AlchemySpacing.gridSpacing) {
            LazyVStack(spacing: AlchemySpacing.gridSpacing) {
                if let pending = effectivePendingSave {
                    savingSkeletonCard(pending)
                }
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
    /// Sparkles for current (positive reinforcement), spinner for
    /// processing, X for failed. Stale/needs_review are handled by the
    /// cookbook-level banner instead of per-card badges.
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

    // MARK: - Stale Variant Banner

    /// Actionable banner shown below filter chips when constraint preferences
    /// changed and saved recipes may need updating. Names the specific fields
    /// that changed so the user understands why, and offers a Review button.
    private func staleVariantBanner(_ ctx: StaleContext) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "sparkles")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(AlchemyColors.accent)

            VStack(alignment: .leading, spacing: 2) {
                Text("\(ctx.changedFieldsSummary) updated")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(AlchemyColors.textPrimary)
                Text("\(ctx.count) \(ctx.count == 1 ? "recipe" : "recipes") may need changes")
                    .font(.system(size: 12))
                    .foregroundStyle(AlchemyColors.textSecondary)
            }

            Spacer(minLength: 4)

            Button {
                showStaleReview = true
            } label: {
                Text("Review")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 7)
                    .background(AlchemyColors.accent, in: Capsule())
            }
            .buttonStyle(.plain)

            Button {
                withAnimation(.easeOut(duration: 0.25)) { staleBannerDismissed = true }
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(AlchemyColors.textTertiary)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(AlchemyColors.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .padding(.horizontal, AlchemySpacing.screenHorizontal)
        .transition(.move(edge: .top).combined(with: .opacity))
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

    // MARK: - Saving Skeleton

    /// Grid-sized skeleton card shown as the first item in the masonry
    /// grid while a recipe is being committed in the background. Matches
    /// the visual proportions of RecipeCardView with a shimmer overlay.
    private func savingSkeletonCard(_ pending: PendingSave) -> some View {
        ZStack(alignment: .bottomLeading) {
            if let urlStr = pending.imageUrl, let url = URL(string: urlStr) {
                RecipeAsyncImage(
                    url: url,
                    profile: .card
                ) {
                    skeletonShimmer
                } failure: {
                    skeletonShimmer
                }
                .frame(minHeight: 180, maxHeight: 220)
                .clipped()
            } else {
                skeletonShimmer
                    .frame(minHeight: 180, maxHeight: 220)
            }

            Color.black.opacity(0.15)

            LinearGradient(
                colors: [.clear, .clear, .black.opacity(0.55)],
                startPoint: .top,
                endPoint: .bottom
            )

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    ProgressView()
                        .tint(.white)
                        .scaleEffect(0.6)
                    Text("Saving…")
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(.white.opacity(0.7))
                }

                Text(pending.title)
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(.white)
                    .lineLimit(2)
                    .shadow(color: .black.opacity(0.7), radius: 4, x: 0, y: 2)
            }
            .padding(10)
        }
        .clipShape(RoundedRectangle(cornerRadius: AlchemySpacing.cardRadius))
        .transition(.opacity.combined(with: .scale(scale: 0.95)))
        .animation(.easeInOut(duration: 0.3), value: effectivePendingSave != nil)
    }

    /// Animated shimmer placeholder for the skeleton card image area.
    private var skeletonShimmer: some View {
        Rectangle()
            .fill(AlchemyColors.surfaceSecondary)
            .overlay {
                Rectangle()
                    .fill(
                        LinearGradient(
                            colors: [
                                .clear,
                                .white.opacity(0.08),
                                .clear,
                            ],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .phaseAnimator([false, true]) { content, phase in
                        content.offset(x: phase ? 300 : -300)
                    } animation: { _ in
                        .easeInOut(duration: 1.5).repeatForever(autoreverses: false)
                    }
            }
            .clipped()
    }

    // MARK: - API

    private func loadCookbook() async {
        print("[CookbookView] loadCookbook called, previews=\(previews.count), isLoading=\(isLoading)")
        if previews.isEmpty { isLoading = true }
        errorMessage = nil

        do {
            let response: CookbookResponse = try await APIClient.shared.request("/recipes/cookbook")
            print("[CookbookView] loaded \(response.items.count) items, \(response.suggestedChips.count) chips")
            previews = response.items
            suggestedChips = response.suggestedChips
            staleContext = response.staleContext
            if response.staleContext == nil { staleBannerDismissed = false }
            trackCookbookView(itemCount: response.items.count)
        } catch {
            if case NetworkError.noAccessToken = error {
                errorMessage = "Session expired — please sign in again."
            } else {
                errorMessage = "Couldn't load cookbook: \(error.localizedDescription)"
            }
            print("[CookbookView] load failed: \(error)")
        }

        isLoading = false
        print("[CookbookView] loadCookbook done, previews=\(previews.count), isLoading=\(isLoading)")
    }

    private func unsaveRecipe(_ id: String) async {
        do {
            try await APIClient.shared.requestVoid("/recipes/cookbook/\(id)", method: .delete)
            withAnimation {
                previews.removeAll { $0.id == id }
            }
            BehaviorTelemetry.shared.track(
                eventType: "cookbook_recipe_unsaved",
                surface: "cookbook",
                sessionId: cookbookSessionId,
                entityType: "cookbook_entry",
                entityId: id
            )
        } catch {
            print("[CookbookView] unsave failed: \(error)")
        }
    }

    private func trackCookbookView(itemCount: Int) {
        let now = Date()
        if let lastCookbookViewTrackedAt, now.timeIntervalSince(lastCookbookViewTrackedAt) < 30 {
            return
        }

        lastCookbookViewTrackedAt = now
        BehaviorTelemetry.shared.track(
            eventType: "cookbook_viewed",
            surface: "cookbook",
            sessionId: cookbookSessionId,
            payload: [
                "item_count": .int(itemCount),
                "smart_chip_count": .int(suggestedChips.count),
            ]
        )
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
                        RecipeAsyncImage(
                            url: preview.resolvedImageURL,
                            profile: .fullScreenFeed
                        ) {
                            Rectangle().fill(AlchemyColors.surfaceSecondary)
                        } failure: {
                            Rectangle().fill(AlchemyColors.surfaceSecondary)
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
            id: cookbookEntryId,
            title: title,
            summary: summary,
            category: category ?? "Uncategorized",
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
            category: category ?? "Uncategorized",
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

// MARK: - Stale Variant Review Sheet

/// Half-sheet presenting stale recipes with bulk and per-recipe actions.
/// "Update All" at the top adapts every recipe in one tap. Below, each
/// recipe has Adapt / Keep Original / Remove for granular control.
struct StaleVariantReviewSheet: View {
    let context: StaleContext
    let recipes: [CookbookEntryItem]
    let onComplete: () -> Void

    /// Per-recipe resolved status: nil = pending, "adapted", "kept", "removed", "failed".
    @State private var recipeStatus: [String: String] = [:]
    @State private var isBulkUpdating = false
    @Environment(\.dismiss) private var dismiss

    /// True once every recipe has been resolved (adapted, kept, or removed).
    private var allResolved: Bool {
        recipes.allSatisfy { recipeStatus[$0.id] != nil }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: AlchemySpacing.lg) {
                    headerSection
                    bulkUpdateButton
                    Divider()
                        .overlay(AlchemyColors.surfaceSecondary)
                    recipeList
                }
                .padding(.vertical, AlchemySpacing.lg)
            }
            .background(AlchemyColors.background)
            .navigationTitle("Review Recipes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        onComplete()
                    }
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .onChange(of: allResolved) { _, resolved in
            if resolved {
                // Brief delay so the user sees the last row resolve,
                // then auto-dismiss. Feels responsive, not abrupt.
                Task {
                    try? await Task.sleep(for: .milliseconds(800))
                    onComplete()
                }
            }
        }
    }

    // MARK: - Header

    private var headerSection: some View {
        VStack(spacing: AlchemySpacing.sm) {
            Image(systemName: "sparkles")
                .font(.system(size: 28))
                .foregroundStyle(AlchemyColors.accent)

            Text("\(context.changedFieldsSummary) Updated")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(AlchemyColors.textPrimary)
                .multilineTextAlignment(.center)

            Text("\(context.count) \(context.count == 1 ? "recipe" : "recipes") in your cookbook may need updating to match your new preferences.")
                .font(.system(size: 14))
                .foregroundStyle(AlchemyColors.textSecondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, AlchemySpacing.xl)
    }

    // MARK: - Bulk Update

    private var bulkUpdateButton: some View {
        Button {
            Task { await updateAll() }
        } label: {
            HStack(spacing: 8) {
                if isBulkUpdating {
                    ProgressView()
                        .controlSize(.small)
                        .tint(.black)
                } else {
                    Image(systemName: "arrow.triangle.2.circlepath")
                        .font(.system(size: 14, weight: .semibold))
                }
                Text(isBulkUpdating ? "Updating…" : "Update All (\(pendingCount))")
                    .font(.system(size: 15, weight: .semibold))
            }
            .foregroundStyle(.black)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(.white, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(isBulkUpdating || pendingCount == 0)
        .opacity(pendingCount == 0 ? 0.4 : 1)
        .padding(.horizontal, AlchemySpacing.screenHorizontal)
    }

    private var pendingCount: Int {
        recipes.filter { recipeStatus[$0.id] == nil }.count
    }

    // MARK: - Per-Recipe List

    private var recipeList: some View {
        LazyVStack(spacing: 0) {
            ForEach(recipes) { recipe in
                recipeRow(recipe)
                if recipe.id != recipes.last?.id {
                    Divider()
                        .overlay(AlchemyColors.surfaceSecondary)
                        .padding(.leading, 72)
                }
            }
        }
    }

    private func recipeRow(_ recipe: CookbookEntryItem) -> some View {
        let status = recipeStatus[recipe.id]

        return HStack(spacing: 12) {
            // Thumbnail
            RecipeAsyncImage(
                url: recipe.resolvedImageURL,
                profile: .card
            ) {
                Rectangle().fill(AlchemyColors.surfaceSecondary)
            } failure: {
                Rectangle().fill(AlchemyColors.surfaceSecondary)
            }
            .frame(width: 52, height: 52)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

            // Title + status
            VStack(alignment: .leading, spacing: 2) {
                Text(recipe.title)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(AlchemyColors.textPrimary)
                    .lineLimit(2)

                if let status {
                    Text(statusLabel(status))
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(statusColor(status))
                }
            }

            Spacer(minLength: 4)

            // Action buttons — hidden once resolved
            if status == nil {
                HStack(spacing: 6) {
                    actionButton("Adapt", icon: "arrow.triangle.2.circlepath") {
                        await adaptRecipe(recipe.id)
                    }
                    actionButton("Keep", icon: "checkmark") {
                        await keepRecipe(recipe.id)
                    }
                    actionButton("Remove", icon: "trash", destructive: true) {
                        await removeRecipe(recipe.id)
                    }
                }
            }
        }
        .padding(.horizontal, AlchemySpacing.screenHorizontal)
        .padding(.vertical, 10)
        .opacity(status == "removed" ? 0.4 : 1)
        .animation(.easeInOut(duration: 0.25), value: status)
    }

    private func actionButton(
        _ label: String,
        icon: String,
        destructive: Bool = false,
        action: @escaping () async -> Void
    ) -> some View {
        Button {
            Task { await action() }
        } label: {
            VStack(spacing: 3) {
                Image(systemName: icon)
                    .font(.system(size: 12, weight: .medium))
                Text(label)
                    .font(.system(size: 10, weight: .medium))
            }
            .foregroundStyle(destructive ? .red.opacity(0.8) : AlchemyColors.textSecondary)
            .frame(width: 52, height: 40)
            .background(AlchemyColors.surfaceSecondary, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Actions

    private func updateAll() async {
        isBulkUpdating = true
        let pending = recipes.filter { recipeStatus[$0.id] == nil }

        await withTaskGroup(of: Void.self) { group in
            for recipe in pending {
                group.addTask { await adaptRecipe(recipe.id) }
            }
        }

        isBulkUpdating = false
    }

    private func adaptRecipe(_ id: String) async {
        do {
            try await APIClient.shared.requestVoid(
                "/recipes/\(id)/variant/refresh",
                method: .post
            )
            await MainActor.run { recipeStatus[id] = "adapted" }
        } catch {
            print("[StaleReview] adapt failed for \(id): \(error)")
            await MainActor.run { recipeStatus[id] = "failed" }
        }
    }

    private func keepRecipe(_ id: String) async {
        do {
            try await APIClient.shared.requestVoid(
                "/recipes/\(id)/variant/dismiss",
                method: .post
            )
            await MainActor.run { recipeStatus[id] = "kept" }
        } catch {
            print("[StaleReview] keep failed for \(id): \(error)")
            await MainActor.run { recipeStatus[id] = "failed" }
        }
    }

    private func removeRecipe(_ id: String) async {
        do {
            try await APIClient.shared.requestVoid(
                "/recipes/\(id)/save",
                method: .delete
            )
            await MainActor.run { recipeStatus[id] = "removed" }
        } catch {
            print("[StaleReview] remove failed for \(id): \(error)")
            await MainActor.run { recipeStatus[id] = "failed" }
        }
    }

    // MARK: - Helpers

    private func statusLabel(_ status: String) -> String {
        switch status {
        case "adapted": return "Updated"
        case "kept": return "Kept as-is"
        case "removed": return "Removed"
        case "failed": return "Failed — try again"
        default: return ""
        }
    }

    private func statusColor(_ status: String) -> Color {
        switch status {
        case "adapted", "kept": return .green
        case "removed": return AlchemyColors.textTertiary
        case "failed": return .red
        default: return AlchemyColors.textSecondary
        }
    }
}
