import SwiftUI
import NukeUI

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

    @State private var detail: RecipeDetail?
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var isSaved = false

    @State private var tweakText = ""
    @State private var isTweaking = false
    @State private var tweakConflicts: [String]?
    @Environment(\.dismiss) private var dismiss
    @FocusState private var tweakBarFocused: Bool

    @State private var heroHeight: CGFloat = 0
    @State private var scrollOffset: CGFloat = 0
    private let heroFraction: CGFloat = 0.4

    private var titleIsPinned: Bool {
        scrollOffset < -(heroHeight - 100)
    }

    // MARK: - Initializers

    /// Fetch-by-ID initializer (most common path)
    init(recipeId: String, showAddToCookbook: Bool = false, showShareButton: Bool = true, showTweakBar: Bool = true, isEmbedded: Bool = false) {
        self.recipeId = recipeId
        self.preloadedDetail = nil
        self.showAddToCookbook = showAddToCookbook
        self.showShareButton = showShareButton
        self.showTweakBar = showTweakBar
        self.isEmbedded = isEmbedded
    }

    /// Pre-loaded detail initializer (used after commit or from candidate)
    init(detail: RecipeDetail, showAddToCookbook: Bool = false, showShareButton: Bool = true, showTweakBar: Bool = true, isEmbedded: Bool = false) {
        self.recipeId = nil
        self.preloadedDetail = detail
        self.showAddToCookbook = showAddToCookbook
        self.showShareButton = showShareButton
        self.showTweakBar = showTweakBar
        self.isEmbedded = isEmbedded
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
    }

    // MARK: - Loading / Error

    private var loadingView: some View {
        ZStack {
            AlchemyColors.background.ignoresSafeArea()
            ProgressView().tint(.white)
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
                    .padding(.bottom, 120)
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

                Color.black.opacity(0.45)
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
    /// - "pending"/"processing" → animated shimmer placeholder
    /// - "failed" or no URL → static dark placeholder
    @ViewBuilder
    private func heroImageContent(_ recipe: RecipeDetail, size: CGSize) -> some View {
        let status = recipe.imageStatus.lowercased()

        if status == "pending" || status == "processing" {
            ImageShimmerPlaceholder()
        } else if let url = recipe.resolvedImageURL {
            LazyImage(url: url) { state in
                if let image = state.image {
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                } else if state.error != nil {
                    Rectangle().fill(AlchemyColors.surfaceSecondary)
                } else {
                    ImageShimmerPlaceholder()
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

            VStack(spacing: 0) {
                ForEach(recipe.ingredients) { ingredient in
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

                    Divider().overlay(AlchemyColors.separator)
                }
            }
        }
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
    }

    private func saveRecipe(_ id: String) async {
        do {
            try await APIClient.shared.requestVoid("/recipes/\(id)/save", method: .post)
            withAnimation { isSaved = true }
        } catch {
            print("[RecipeDetailView] save failed: \(error)")
        }
    }

    /// Sends manual edit instructions to variant/refresh, then reloads
    /// the recipe to show the updated variant. If conflicts are detected,
    /// shows the conflict banner instead of silently applying.
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

            // Reload the recipe to reflect the personalized variant.
            await loadRecipe()
        } catch {
            print("[RecipeDetailView] tweak failed: \(error)")
        }

        isTweaking = false
    }
}

private struct ScrollOffsetKey: PreferenceKey {
    nonisolated(unsafe) static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

// MARK: - Image Shimmer Placeholder

/// Skeleton shimmer placeholder for the hero image area while the
/// recipe image is being generated. Uses a wide, soft gradient pulse
/// that fades in and out rather than sliding, avoiding the pixelated
/// edge artifacts of a translating narrow band.
struct ImageShimmerPlaceholder: View {
    @State private var shimmerActive = false

    var body: some View {
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
