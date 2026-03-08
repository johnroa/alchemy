import SwiftUI
import NukeUI
import Lottie

/// Full recipe detail view with hero image, sticky scroll title, ingredient table,
/// steps, and floating tweak chat bar.
///
/// Can be initialized two ways:
/// 1. `RecipeDetailView(recipeId:)` — fetches from GET /recipes/{id}
/// 2. `RecipeDetailView(detail:)` — uses a pre-fetched RecipeDetail
///
/// Scroll behavior:
/// 1. Hero image extends to the very top of the device (ignores safe area)
/// 2. Dark overlay on hero for readability
/// 3. On scroll, hero compresses upward
/// 4. When title reaches the nav bar area, it pins as a sticky header
struct RecipeDetailView: View {
    /// Recipe ID to fetch — mutually exclusive with `detail`.
    let recipeId: String?
    /// Pre-fetched recipe detail — used when navigating from Generate after commit.
    let preloadedDetail: RecipeDetail?
    /// Surface that led to this detail view, used for first-party attribution.
    var sourceSurface: String? = nil
    /// Upstream session identifier, such as an Explore search ID.
    var sourceSessionId: String? = nil
    /// Upstream algorithm version for attribution when this detail came from For You.
    var algorithmVersion: String? = nil

    /// Whether this view should show "Add to Cookbook" (save) action
    var showAddToCookbook: Bool = false
    /// Whether to show the share button in the toolbar
    var showShareButton: Bool = true
    /// Whether to show the built-in tweak bar at the bottom
    var showTweakBar: Bool = true
    /// When embedded inside another NavigationStack (e.g. GenerateView),
    /// the parent owns the toolbar. Setting this false prevents duplicate
    /// nav bar items that cause the toolbar to render double-wide.
    var isEmbedded: Bool = false
    /// Disable product behavior telemetry for transient candidate previews.
    var trackBehavior: Bool = true

    @State private var detail: RecipeDetail?
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var isSaved = false

    @State private var tweakText = ""
    @State private var isTweaking = false
    @State private var tweakConflicts: [String]?
    @State private var substitutionDiffs: [SubstitutionDiff] = []
    @State private var adaptationSummary: String?
    @State private var showChanges = false
    @Environment(\.dismiss) private var dismiss
    @FocusState private var tweakBarFocused: Bool

    @State private var heroHeight: CGFloat = 0
    @State private var scrollOffset: CGFloat = 0
    @State private var detailSessionId = UUID().uuidString
    @State private var lastActiveAt: Date?
    @State private var cumulativeActiveDwellSeconds = 0
    @State private var heartbeatTask: Task<Void, Never>?
    @State private var hasTrackedOpen = false
    @State private var hasTrackedCook = false
    @Environment(\.scenePhase) private var scenePhase
    private let heroFraction: CGFloat = 0.4

    private var titleIsPinned: Bool {
        scrollOffset < -(heroHeight - 100)
    }

    // MARK: - Initializers

    /// Fetch-by-ID initializer (most common path)
    init(
        recipeId: String,
        sourceSurface: String? = nil,
        sourceSessionId: String? = nil,
        algorithmVersion: String? = nil,
        showAddToCookbook: Bool = false,
        showShareButton: Bool = true,
        showTweakBar: Bool = true,
        isEmbedded: Bool = false,
        trackBehavior: Bool = true
    ) {
        self.recipeId = recipeId
        self.preloadedDetail = nil
        self.sourceSurface = sourceSurface
        self.sourceSessionId = sourceSessionId
        self.algorithmVersion = algorithmVersion
        self.showAddToCookbook = showAddToCookbook
        self.showShareButton = showShareButton
        self.showTweakBar = showTweakBar
        self.isEmbedded = isEmbedded
        self.trackBehavior = trackBehavior
    }

    /// Pre-loaded detail initializer (used after commit or from candidate)
    init(
        detail: RecipeDetail,
        sourceSurface: String? = nil,
        sourceSessionId: String? = nil,
        algorithmVersion: String? = nil,
        showAddToCookbook: Bool = false,
        showShareButton: Bool = true,
        showTweakBar: Bool = true,
        isEmbedded: Bool = false,
        trackBehavior: Bool = true
    ) {
        self.recipeId = nil
        self.preloadedDetail = detail
        self.sourceSurface = sourceSurface
        self.sourceSessionId = sourceSessionId
        self.algorithmVersion = algorithmVersion
        self.showAddToCookbook = showAddToCookbook
        self.showShareButton = showShareButton
        self.showTweakBar = showTweakBar
        self.isEmbedded = isEmbedded
        self.trackBehavior = trackBehavior
    }

    var body: some View {
        Group {
            if isLoading && detail == nil {
                loadingView
            } else if let errorMessage, detail == nil {
                errorView(errorMessage)
            } else if let recipe = detail {
                recipeContent(recipe)
            }
        }
        .background(AlchemyColors.background)
        .ignoresSafeArea(edges: .top)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .toolbar {
            if !isEmbedded {
                ToolbarItem(placement: .topBarTrailing) {
                    Group {
                        if let recipe = detail {
                            toolbarActions(recipe)
                        }
                    }
                }
            }
        }
        .toolbarVisibility(.hidden, for: .tabBar)
        .animation(.easeInOut(duration: 0.2), value: titleIsPinned)
        .task { await loadRecipe() }
        .onChange(of: scenePhase) { _, _ in
            handleBehaviorLifecycle()
        }
        .onChange(of: detail?.id) { _, _ in
            handleBehaviorLifecycle()
        }
        .onDisappear {
            finalizeBehaviorSession()
        }
    }

    // MARK: - Loading / Error

    private var loadingView: some View {
        ZStack {
            AlchemyColors.background.ignoresSafeArea()
            AlchemyLoadingIndicator()
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
            Button("Retry") { Task { await loadRecipe() } }
                .foregroundStyle(AlchemyColors.accent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(AlchemyColors.background)
    }

    // MARK: - Recipe Content

    private func recipeContent(_ recipe: RecipeDetail) -> some View {
        ZStack(alignment: .bottom) {
            ScrollView {
                VStack(spacing: 0) {
                    heroSection(recipe)

                    VStack(alignment: .leading, spacing: AlchemySpacing.xl) {
                        if !substitutionDiffs.isEmpty {
                            sousChefChangesSection
                            Divider().overlay(AlchemyColors.separator)
                        }

                        ingredientSection(recipe)
                        Divider().overlay(AlchemyColors.separator)
                        stepsSection(recipe)

                        if !recipe.attachments.isEmpty {
                            Divider().overlay(AlchemyColors.separator)
                            attachmentsSection(recipe)
                        }
                    }
                    .padding(.horizontal, AlchemySpacing.screenHorizontal)
                    .padding(.top, AlchemySpacing.xl)
                    // Extra bottom clearance when embedded in GenerateView
                    // so the minimized chat panel (220pt) doesn't hide
                    // the last steps/content.
                    .padding(.bottom, isEmbedded ? 260 : 120)
                }
                .background(
                    GeometryReader { geo in
                        Color.clear.preference(
                            key: ScrollOffsetKey.self,
                            value: geo.frame(in: .named("scroll")).minY
                        )
                    }
                )
            }
            .coordinateSpace(name: "scroll")
            .onPreferenceChange(ScrollOffsetKey.self) { value in
                scrollOffset = value
            }
            .scrollDismissesKeyboard(.interactively)
            .onTapGesture { tweakBarFocused = false }

            if titleIsPinned {
                stickyTitleBar(recipe)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }

            if showTweakBar {
                VStack(spacing: 0) {
                    Spacer()

                    // Conflict banner: shown when manual edits conflict
                    // with current dietary constraints after re-personalization.
                    if let conflicts = tweakConflicts, !conflicts.isEmpty {
                        VStack(alignment: .leading, spacing: AlchemySpacing.xs) {
                            Label("Needs Review", systemImage: "exclamationmark.triangle.fill")
                                .font(AlchemyTypography.captionBold)
                                .foregroundStyle(.orange)
                            ForEach(conflicts, id: \.self) { conflict in
                                Text("• \(conflict)")
                                    .font(AlchemyTypography.caption)
                                    .foregroundStyle(AlchemyColors.textSecondary)
                            }
                        }
                        .padding(AlchemySpacing.md)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(.ultraThinMaterial)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .padding(.horizontal, AlchemySpacing.screenHorizontal)
                        .padding(.bottom, AlchemySpacing.sm)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                    }

                    GlassInputBar(
                        placeholder: isTweaking
                            ? "Personalizing…"
                            : "Make changes, add a side, change servings",
                        text: $tweakText,
                        onSubmit: {
                            let instructions = tweakText.trimmingCharacters(in: .whitespacesAndNewlines)
                            guard !instructions.isEmpty, !isTweaking else { return }
                            tweakText = ""
                            tweakBarFocused = false
                            Task { await submitTweak(instructions) }
                        }
                    )
                    .focused($tweakBarFocused)
                    .disabled(isTweaking)
                    .opacity(isTweaking ? 0.6 : 1.0)
                    .background(
                        Ellipse()
                            .fill(.ultraThinMaterial)
                            .frame(width: 400, height: 80)
                            .blur(radius: 20)
                            .opacity(0.8)
                    )
                    .padding(.bottom, AlchemySpacing.md)
                }
            }
        }
    }

    // MARK: - Hero Section

    private func heroSection(_ recipe: RecipeDetail) -> some View {
        GeometryReader { geo in
            let height = geo.size.height
            ZStack(alignment: .bottomLeading) {
                heroImageContent(recipe, size: geo.size)
                    .frame(width: geo.size.width, height: height)
                    .clipped()

                Color.black.opacity(0.2)
                AlchemyColors.heroGradient

                Text(recipe.title)
                    .font(AlchemyTypography.displayLarge)
                    .foregroundStyle(.white)
                    .shadow(color: .black.opacity(0.6), radius: 8, x: 0, y: 2)
                    .padding(.horizontal, AlchemySpacing.screenHorizontal)
                    .padding(.bottom, AlchemySpacing.xl)
            }
            .onAppear { heroHeight = height }
        }
        .containerRelativeFrame(.vertical) { height, _ in
            height * heroFraction
        }
    }

    /// Chooses the right hero content based on image readiness:
    /// - "ready" → loads the actual image via Nuke
    /// - "pending"/"processing" → Lottie loading indicator (embedded)
    ///   or shimmer placeholder (standalone)
    /// - "failed" or no URL → static dark placeholder
    @ViewBuilder
    private func heroImageContent(_ recipe: RecipeDetail, size: CGSize) -> some View {
        let status = recipe.imageStatus.lowercased()

        if status == "pending" || status == "processing" {
            ImageLoadingPlaceholder(isEmbedded: isEmbedded)
        } else if let url = recipe.resolvedImageURL {
            LazyImage(url: url) { state in
                if let image = state.image {
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                        .transition(.opacity.animation(.easeInOut(duration: 0.4)))
                } else if state.error != nil {
                    Rectangle().fill(AlchemyColors.surfaceSecondary)
                } else {
                    ImageLoadingPlaceholder(isEmbedded: isEmbedded)
                }
            }
        } else {
            Rectangle().fill(AlchemyColors.surfaceSecondary)
        }
    }

    // MARK: - Sticky Title Bar

    private func stickyTitleBar(_ recipe: RecipeDetail) -> some View {
        VStack {
            VStack(spacing: 0) {
                Rectangle()
                    .fill(AlchemyColors.surface.opacity(0.95))
                    .frame(height: 60)
                    .overlay {
                        Text(recipe.title)
                            .font(AlchemyTypography.subheading)
                            .foregroundStyle(AlchemyColors.textPrimary)
                            .lineLimit(1)
                            .padding(.horizontal, AlchemySpacing.screenHorizontal)
                    }
                    .overlay(alignment: .bottom) {
                        Divider().overlay(AlchemyColors.separator)
                    }
            }
            .frame(maxWidth: .infinity)
            Spacer()
        }
        .ignoresSafeArea(edges: .top)
    }

    // MARK: - Ingredients

    private func ingredientSection(_ recipe: RecipeDetail) -> some View {
        VStack(alignment: .leading, spacing: AlchemySpacing.md) {
            Text("Ingredients")
                .font(AlchemyTypography.heading)
                .foregroundStyle(AlchemyColors.textPrimary)

            Text("\(recipe.servings) servings")
                .font(AlchemyTypography.caption)
                .foregroundStyle(AlchemyColors.textSecondary)

            if let groups = recipe.ingredientGroups, groups.count > 1 {
                VStack(alignment: .leading, spacing: AlchemySpacing.lg) {
                    ForEach(Array(groups.enumerated()), id: \.offset) { index, group in
                        VStack(alignment: .leading, spacing: AlchemySpacing.sm) {
                            Text(group.label)
                                .font(AlchemyTypography.captionBold)
                                .foregroundStyle(AlchemyColors.textSecondary)

                            ingredientRows(group.ingredients)
                        }

                        if index < groups.count - 1 {
                            Divider().overlay(AlchemyColors.separator)
                        }
                    }
                }
            } else {
                ingredientRows(recipe.ingredients)
            }
        }
    }

    private func ingredientRows(_ ingredients: [APIIngredient]) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(ingredients.enumerated()), id: \.offset) { index, ingredient in
                ingredientRow(ingredient)

                if index < ingredients.count - 1 {
                    Divider().overlay(AlchemyColors.separator)
                }
            }
        }
    }

    private func ingredientRow(_ ingredient: APIIngredient) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(ingredient.name)
                    .font(AlchemyTypography.ingredientName)
                    .foregroundStyle(AlchemyColors.textPrimary)

                if let prep = ingredient.preparation, !prep.isEmpty {
                    Text(prep)
                        .font(AlchemyTypography.caption)
                        .foregroundStyle(AlchemyColors.textTertiary)
                }
            }

            Spacer()

            Text(ingredient.displayQuantity)
                .font(AlchemyTypography.ingredientQuantity)
                .foregroundStyle(AlchemyColors.textPrimary)
        }
        .padding(.vertical, AlchemySpacing.md)
    }

    // MARK: - Steps

    private func stepsSection(_ recipe: RecipeDetail) -> some View {
        VStack(alignment: .leading, spacing: AlchemySpacing.lg) {
            Text("Steps")
                .font(AlchemyTypography.heading)
                .foregroundStyle(AlchemyColors.textPrimary)

            ForEach(recipe.steps) { step in
                HStack(alignment: .top, spacing: AlchemySpacing.md) {
                    Text("\(step.index)")
                        .font(AlchemyTypography.captionBold)
                        .foregroundStyle(AlchemyColors.accent)
                        .frame(width: 28, height: 28)
                        .background(AlchemyColors.accent.opacity(0.15))
                        .clipShape(Circle())

                    VStack(alignment: .leading, spacing: 4) {
                        Text(step.instruction)
                            .font(AlchemyTypography.body)
                            .foregroundStyle(AlchemyColors.textPrimary)
                            .fixedSize(horizontal: false, vertical: true)

                        if let notes = step.notes, !notes.isEmpty {
                            Text(notes)
                                .font(AlchemyTypography.caption)
                                .foregroundStyle(AlchemyColors.textTertiary)
                        }

                        if let timer = step.timerSeconds, timer > 0 {
                            Label("\(timer / 60) min", systemImage: "timer")
                                .font(AlchemyTypography.caption)
                                .foregroundStyle(AlchemyColors.accent)
                        }
                    }
                }
            }
        }
    }

    // MARK: - Attachments (sides, appetizers, etc.)

    private func attachmentsSection(_ recipe: RecipeDetail) -> some View {
        VStack(alignment: .leading, spacing: AlchemySpacing.md) {
            Text("Companions")
                .font(AlchemyTypography.heading)
                .foregroundStyle(AlchemyColors.textPrimary)

            ForEach(recipe.attachments) { attachment in
                NavigationLink(value: attachment.recipe.id) {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(attachment.relationType.capitalized)
                                .font(AlchemyTypography.caption)
                                .foregroundStyle(AlchemyColors.accent)
                            Text(attachment.recipe.title)
                                .font(AlchemyTypography.subheading)
                                .foregroundStyle(AlchemyColors.textPrimary)
                        }
                        Spacer()
                        Image(systemName: "chevron.right")
                            .foregroundStyle(AlchemyColors.textTertiary)
                    }
                    .padding(AlchemySpacing.md)
                    .background(AlchemyColors.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
            }
        }
    }

    // MARK: - Toolbar

    @ViewBuilder
    private func toolbarActions(_ recipe: RecipeDetail) -> some View {
        HStack(spacing: AlchemySpacing.sm) {
            if showAddToCookbook {
                Button {
                    Task { await saveRecipe(recipe.id) }
                } label: {
                    Image(systemName: isSaved ? "bookmark.fill" : "bookmark")
                        .foregroundStyle(isSaved ? AlchemyColors.accent : AlchemyColors.textPrimary)
                }
            }

            if showShareButton {
                ShareLink(
                    item: recipe.title,
                    subject: Text(recipe.title),
                    message: Text(recipe.summary)
                ) {
                    Image(systemName: "square.and.arrow.up")
                        .foregroundStyle(AlchemyColors.textPrimary)
                }
            }
        }
    }

    // MARK: - API

    private func loadRecipe() async {
        if let preloadedDetail {
            detail = preloadedDetail
            isLoading = false
            await loadVariantDiffs()
            return
        }

        guard let recipeId else {
            errorMessage = "No recipe to display."
            isLoading = false
            return
        }

        isLoading = true
        errorMessage = nil

        do {
            let fetched: RecipeDetail = try await APIClient.shared.request("/recipes/\(recipeId)")
            detail = fetched
        } catch {
            errorMessage = "Couldn't load this recipe."
            print("[RecipeDetailView] load failed: \(error)")
        }

        isLoading = false
        await loadVariantDiffs()
    }

    private func saveRecipe(_ id: String) async {
        do {
            try await APIClient.shared.requestVoid(
                "/recipes/\(id)/save",
                method: .post,
                body: SaveRecipeRequest(
                    autopersonalize: nil,
                    sourceSurface: sourceSurface,
                    sourceSessionId: sourceSessionId,
                    algorithmVersion: algorithmVersion
                )
            )
            withAnimation { isSaved = true }
        } catch {
            print("[RecipeDetailView] save failed: \(error)")
        }
    }

    /// Sends manual edit instructions to variant/refresh, then reloads
    /// the recipe to show the updated variant. If conflicts are detected,
    /// shows the conflict banner instead of silently applying.
    // MARK: - Sous Chef Changes

    /// "What did my Sous Chef change?" — collapsible section showing
    /// ingredient substitutions with the constraint that triggered each
    /// swap and a human-readable reason. Only appears when the variant
    /// has substitution diffs in its provenance.
    private var sousChefChangesSection: some View {
        VStack(alignment: .leading, spacing: AlchemySpacing.sm) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    showChanges.toggle()
                }
            } label: {
                HStack {
                    Image(systemName: "sparkles")
                        .foregroundStyle(AlchemyColors.accent)
                    Text("What did my Sous Chef change?")
                        .font(AlchemyTypography.subheading)
                        .foregroundStyle(AlchemyColors.textPrimary)
                    Spacer()
                    Image(systemName: showChanges ? "chevron.up" : "chevron.down")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(AlchemyColors.textTertiary)
                }
            }
            .buttonStyle(.plain)

            if let summary = adaptationSummary, !summary.isEmpty {
                Text(summary)
                    .font(AlchemyTypography.caption)
                    .foregroundStyle(AlchemyColors.textSecondary)
            }

            if showChanges {
                VStack(alignment: .leading, spacing: AlchemySpacing.sm) {
                    ForEach(substitutionDiffs) { diff in
                        substitutionRow(diff)
                    }
                }
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }

    /// Single substitution row: "flour → almond flour" with constraint
    /// badge and reason text.
    private func substitutionRow(_ diff: SubstitutionDiff) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: AlchemySpacing.xs) {
                Text(diff.original)
                    .font(AlchemyTypography.body)
                    .foregroundStyle(AlchemyColors.textSecondary)
                    .strikethrough(color: AlchemyColors.textTertiary)
                Image(systemName: "arrow.right")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(AlchemyColors.accent)
                Text(diff.replacement)
                    .font(AlchemyTypography.body)
                    .foregroundStyle(AlchemyColors.textPrimary)
            }

            HStack(spacing: AlchemySpacing.xs) {
                Text(diff.constraint)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(AlchemyColors.accent.opacity(0.8))
                    .clipShape(Capsule())

                if !diff.reason.isEmpty {
                    Text(diff.reason)
                        .font(AlchemyTypography.caption)
                        .foregroundStyle(AlchemyColors.textTertiary)
                        .lineLimit(2)
                }
            }
        }
        .padding(AlchemySpacing.sm)
        .background(AlchemyColors.surface.opacity(0.5))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    // MARK: - Variant Detail Loading

    /// Fetches the variant detail for the current recipe to populate
    /// the "What did my Sous Chef change?" section. Called after the
    /// recipe loads. Silently no-ops if no variant exists.
    private func loadVariantDiffs() async {
        guard let id = detail?.id ?? recipeId else { return }
        do {
            let response: VariantDetailResponse = try await APIClient.shared.request(
                "/recipes/\(id)/variant"
            )
            withAnimation {
                substitutionDiffs = response.substitutionDiffs ?? []
                adaptationSummary = response.adaptationSummary
            }
        } catch {
            // No variant or fetch failed — that's fine, section stays hidden.
        }
    }

    private func submitTweak(_ instructions: String) async {
        guard let id = detail?.id ?? recipeId else { return }
        isTweaking = true
        tweakConflicts = nil

        do {
            let response: VariantRefreshResponse = try await APIClient.shared.request(
                "/recipes/\(id)/variant/refresh",
                method: .post,
                body: VariantEditRequest(instructions: instructions)
            )

            if let conflicts = response.conflicts, !conflicts.isEmpty {
                withAnimation { tweakConflicts = conflicts }
            }

            // Update substitution diffs from the refresh response.
            if let diffs = response.substitutionDiffs, !diffs.isEmpty {
                withAnimation {
                    substitutionDiffs = diffs
                    adaptationSummary = response.adaptationSummary
                }

                trackDetailEvent(
                    eventType: "ingredient_substitution_applied",
                    payload: [
                        "diff_count": .int(diffs.count),
                        "has_conflicts": .bool((response.conflicts?.isEmpty == false)),
                    ]
                )
            }

            // Reload the recipe to reflect the personalized variant.
            await loadRecipe()
        } catch {
            print("[RecipeDetailView] tweak failed: \(error)")
        }

        isTweaking = false
    }

    private var behaviorRecipeId: String? {
        detail?.id ?? recipeId ?? preloadedDetail?.id
    }

    private func handleBehaviorLifecycle() {
        guard trackBehavior, detail != nil else { return }

        if scenePhase == .active {
            resumeBehaviorSession()
        } else {
            pauseBehaviorSession()
        }
    }

    private func resumeBehaviorSession() {
        guard trackBehavior, let recipeId = behaviorRecipeId else { return }

        if !hasTrackedOpen {
            trackDetailEvent(
                eventType: "recipe_detail_opened",
                entityId: recipeId,
                payload: [
                    "image_ready": .bool(detail?.imageStatus == "ready"),
                ]
            )
            hasTrackedOpen = true
        }

        guard lastActiveAt == nil else { return }
        lastActiveAt = .now
        startHeartbeatLoop()
    }

    private func pauseBehaviorSession() {
        guard trackBehavior else { return }
        recordActiveDwell(until: .now)
        lastActiveAt = nil
        heartbeatTask?.cancel()
        heartbeatTask = nil
    }

    private func finalizeBehaviorSession() {
        guard trackBehavior, hasTrackedOpen else { return }

        pauseBehaviorSession()

        trackDetailEvent(
            eventType: "recipe_detail_closed",
            payload: [
                "active_dwell_seconds": .int(cumulativeActiveDwellSeconds),
                "cooked_inferred": .bool(hasTrackedCook),
            ]
        )
    }

    private func startHeartbeatLoop() {
        guard heartbeatTask == nil else { return }

        heartbeatTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(15))
                guard !Task.isCancelled else { return }
                await MainActor.run {
                    emitHeartbeat()
                }
            }
        }
    }

    private func emitHeartbeat() {
        guard trackBehavior, scenePhase == .active else { return }

        recordActiveDwell(until: .now)
        lastActiveAt = .now

        trackDetailEvent(
            eventType: "recipe_detail_heartbeat",
            payload: [
                "active_dwell_seconds": .int(cumulativeActiveDwellSeconds),
            ]
        )
    }

    private func recordActiveDwell(until date: Date) {
        guard let lastActiveAt else { return }

        let deltaSeconds = max(0, Int(date.timeIntervalSince(lastActiveAt)))
        if deltaSeconds > 0 {
            cumulativeActiveDwellSeconds += deltaSeconds
        }

        self.lastActiveAt = date

        if !hasTrackedCook, cumulativeActiveDwellSeconds >= 600 {
            hasTrackedCook = true
            trackDetailEvent(
                eventType: "recipe_cooked_inferred",
                payload: [
                    "active_dwell_seconds": .int(cumulativeActiveDwellSeconds),
                ]
            )
        }
    }

    private func trackDetailEvent(
        eventType: String,
        entityId: String? = nil,
        payload: [String: AnyCodableValue]? = nil
    ) {
        guard trackBehavior, let recipeId = entityId ?? behaviorRecipeId else { return }

        var enrichedPayload = payload ?? [:]
        if let sourceSessionId {
            enrichedPayload["source_session_id"] = .string(sourceSessionId)
        }

        BehaviorTelemetry.shared.track(
            eventType: eventType,
            surface: "recipe_detail",
            sessionId: detailSessionId,
            entityType: "recipe",
            entityId: recipeId,
            sourceSurface: sourceSurface,
            algorithmVersion: algorithmVersion,
            payload: enrichedPayload.isEmpty ? nil : enrichedPayload
        )
    }
}

private struct ScrollOffsetKey: PreferenceKey {
    nonisolated(unsafe) static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

// MARK: - Image Loading Placeholder

/// Placeholder shown while the recipe image is being generated.
/// - **Embedded mode** (inside Generate): centered Lottie animation +
///   "Loading recipe image..." text on a dark surface. Calm and stable.
/// - **Standalone mode** (recipe detail): subtle shimmer gradient pulse.
struct ImageLoadingPlaceholder: View {
    var isEmbedded: Bool = false
    @State private var shimmerActive = false

    var body: some View {
        if isEmbedded {
            ZStack {
                Rectangle().fill(AlchemyColors.surface)
                VStack(spacing: AlchemySpacing.md) {
                    LottieView(animation: .named("alchemy-loading"))
                        .playing(loopMode: .loop)
                        .frame(width: 80, height: 80)
                    Text("Loading recipe image...")
                        .font(AlchemyTypography.caption)
                        .foregroundStyle(AlchemyColors.textSecondary)
                }
            }
        } else {
            Rectangle()
                .fill(
                    LinearGradient(
                        colors: [
                            Color(red: 0.12, green: 0.12, blue: 0.14),
                            Color(red: 0.14, green: 0.14, blue: 0.17),
                            Color(red: 0.12, green: 0.12, blue: 0.14),
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .overlay {
                    LinearGradient(
                        stops: [
                            .init(color: .clear, location: 0.0),
                            .init(color: .white.opacity(0.03), location: 0.3),
                            .init(color: .white.opacity(0.06), location: 0.5),
                            .init(color: .white.opacity(0.03), location: 0.7),
                            .init(color: .clear, location: 1.0),
                        ],
                        startPoint: shimmerActive ? .trailing : .leading,
                        endPoint: shimmerActive ? .init(x: 2.0, y: 1.0) : .trailing
                    )
                    .blendMode(.screen)
                }
                .onAppear {
                    withAnimation(
                        .easeInOut(duration: 2.2)
                        .repeatForever(autoreverses: true)
                    ) {
                        shimmerActive = true
                    }
                }
        }
    }
}
