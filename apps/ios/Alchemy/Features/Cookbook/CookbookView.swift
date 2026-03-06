import SwiftUI
import NukeUI

/// Cookbook screen — saved recipes displayed in a staggered masonry 2-column grid.
///
/// Layout (top to bottom):
/// 1. Custom inline header: "Cookbook" left-aligned, ProfileMenu icon right-aligned, vertically centered
/// 2. Search bar (GlassInputBar style)
/// 3. Horizontal Liquid Glass filter chips (All, Italian, Japanese, etc.)
/// 4. Masonry 2-column grid with staggered card heights
///
/// Interactions:
/// - Tap card: full-screen image takeover with dark overlay, title, description, gauges, "Open Recipe"
/// - Long-press: Liquid Glass context menu with [View, Edit, Add Companion, Share, Delete]
/// - "Open Recipe" pushes to RecipeDetailView
///
/// Data source: PreviewData.cookbookCards (dummy). When API is wired,
/// this will use GET /recipes/cookbook with query caching.
struct CookbookView: View {
    @State private var selectedCard: RecipeCard? = nil
    @State private var navigateToRecipe = false
    @State private var showPreferences = false
    @State private var showSettings = false
    @State private var searchText = ""
    @State private var selectedFilter = "All"
    @State private var showFullScreenPreview = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // MARK: - Custom Header
                headerBar

                ScrollView {
                    VStack(spacing: AlchemySpacing.md) {
                        // MARK: - Search Bar
                        searchBar

                        // MARK: - Filter Chips
                        filterChips

                        // MARK: - Masonry Grid
                        masonryGrid
                    }
                    .padding(.bottom, AlchemySpacing.xxxl)
                }
            }
            .background(AlchemyColors.background)
            .navigationBarHidden(true)
            .overlay {
                // Full-screen takeover when a card is tapped
                if showFullScreenPreview, let card = selectedCard {
                    CookbookFullScreenPreview(
                        card: card,
                        onOpenRecipe: {
                            showFullScreenPreview = false
                            selectedCard = nil
                            navigateToRecipe = true
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
            .navigationDestination(isPresented: $navigateToRecipe) {
                RecipeDetailView(recipe: PreviewData.sampleRecipe)
            }
            .sheet(isPresented: $showPreferences) {
                PreferencesView()
            }
            .sheet(isPresented: $showSettings) {
                SettingsView()
            }
            .toolbarVisibility(showFullScreenPreview ? .hidden : .automatic, for: .tabBar)
        }
    }

    // MARK: - Header

    /// Custom inline header with "Cookbook" title and user icon horizontally aligned.
    /// Replaces the default .navigationTitle to keep both elements on the same baseline.
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

    // MARK: - Filter Chips

    /// Horizontal scroll of Liquid Glass filter chips for recipe categories.
    private var filterChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: AlchemySpacing.sm) {
                ForEach(PreviewData.cookbookCategories, id: \.self) { filter in
                    Button {
                        withAnimation(.easeInOut(duration: 0.2)) {
                            selectedFilter = filter
                        }
                    } label: {
                        Text(filter)
                            .font(AlchemyTypography.captionBold)
                            .foregroundStyle(
                                selectedFilter == filter
                                    ? AlchemyColors.textPrimary
                                    : AlchemyColors.textSecondary
                            )
                            .padding(.horizontal, AlchemySpacing.md)
                            .padding(.vertical, AlchemySpacing.sm)
                    }
                    .glassEffect(
                        selectedFilter == filter ? .regular : .clear,
                        in: .capsule
                    )
                }
            }
            .padding(.horizontal, AlchemySpacing.screenHorizontal)
        }
    }

    // MARK: - Masonry Grid

    /// Two-column masonry layout with staggered heights.
    /// LazyVGrid doesn't support variable row heights, so we manually split
    /// cards into left/right columns and use two side-by-side LazyVStacks.
    private var masonryGrid: some View {
        let cards = PreviewData.cookbookCards
        let leftCards = cards.enumerated().filter { $0.offset % 2 == 0 }.map(\.element)
        let rightCards = cards.enumerated().filter { $0.offset % 2 != 0 }.map(\.element)

        return HStack(alignment: .top, spacing: AlchemySpacing.gridSpacing) {
            // Left column
            LazyVStack(spacing: AlchemySpacing.gridSpacing) {
                ForEach(leftCards) { card in
                    cardCell(card)
                }
            }

            // Right column
            LazyVStack(spacing: AlchemySpacing.gridSpacing) {
                ForEach(rightCards) { card in
                    cardCell(card)
                }
            }
        }
        .padding(.horizontal, AlchemySpacing.screenHorizontal)
    }

    /// Individual card cell with tap and long-press gestures.
    private func cardCell(_ card: RecipeCard) -> some View {
        RecipeCardView(card: card)
            .onTapGesture {
                selectedCard = card
                withAnimation(.easeInOut(duration: 0.3)) {
                    showFullScreenPreview = true
                }
            }
            .contextMenu {
                Button {
                    selectedCard = card
                    withAnimation {
                        showFullScreenPreview = true
                    }
                } label: {
                    Label("View", systemImage: "eye")
                }

                Button {
                    // Edit — will navigate to generate with recipe loaded
                } label: {
                    Label("Edit", systemImage: "pencil")
                }

                Button {
                    // Add companion — triggers generate with context
                } label: {
                    Label("Add Companion", systemImage: "plus.circle")
                }

                ShareLink(
                    item: card.title,
                    subject: Text(card.title),
                    message: Text(card.summary)
                ) {
                    Label("Share", systemImage: "square.and.arrow.up")
                }

                Divider()

                Button(role: .destructive) {
                    // Delete — will call DELETE /recipes/{id}/save
                } label: {
                    Label("Delete", systemImage: "trash")
                }
            } preview: {
                RecipeCardView(card: card, fixedHeight: 330)
                    .frame(width: 280)
            }
    }
}

// MARK: - Full Screen Preview

/// Bottom-anchored recipe preview that slides up from the bottom, covering 90% of
/// the screen. The top 10% remains visible so the user can drag the panel back down
/// to dismiss. No nav bar is shown.
///
/// The card's image fills the panel with a dark overlay. Title, description,
/// gauges, and "Open Recipe" are layered on top with proper text constraints.
struct CookbookFullScreenPreview: View {
    let card: RecipeCard
    var onOpenRecipe: () -> Void
    var onDismiss: () -> Void

    /// Drag offset for the dismiss gesture — pulling down dismisses the panel
    @State private var dragOffset: CGFloat = 0

    /// Threshold in points: if the user drags down past this, we dismiss
    private let dismissThreshold: CGFloat = 120

    private var stats: QuickStats {
        PreviewData.sampleRecipe.quickStats ?? QuickStats(
            timeMinutes: 30, difficulty: 0.5, healthScore: 0.7, ingredientCount: 8
        )
    }

    var body: some View {
        GeometryReader { geo in
            let panelHeight = geo.size.height * 0.90

            ZStack {
                // Dimmed background — tap to dismiss
                Color.black.opacity(0.4)
                    .ignoresSafeArea()
                    .onTapGesture { onDismiss() }

                // Bottom-anchored panel
                VStack {
                    Spacer()

                    ZStack(alignment: .top) {
                        // Full-bleed background image clipped to panel
                        LazyImage(url: card.imageURL) { state in
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

                        // Dark overlay
                        Color.black.opacity(0.55)

                        // Content
                        VStack(spacing: AlchemySpacing.lg) {
                            // Drag handle
                            RoundedRectangle(cornerRadius: 2.5)
                                .fill(.white.opacity(0.5))
                                .frame(width: 36, height: 5)
                                .padding(.top, AlchemySpacing.md)

                            Spacer()

                            // Title and description — padded to stay within bounds
                            VStack(spacing: AlchemySpacing.sm) {
                                Text(card.title)
                                    .font(AlchemyTypography.displayLarge)
                                    .foregroundStyle(.white)
                                    .multilineTextAlignment(.center)
                                    .lineLimit(3)
                                    .shadow(color: .black.opacity(0.5), radius: 8, x: 0, y: 2)

                                Text(card.summary)
                                    .font(AlchemyTypography.body)
                                    .foregroundStyle(.white.opacity(0.85))
                                    .multilineTextAlignment(.center)
                                    .lineLimit(3)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            .padding(.horizontal, AlchemySpacing.xl + AlchemySpacing.sm)

                            // Gauge row
                            HStack(spacing: AlchemySpacing.xl) {
                                NutritionGauge.time(minutes: stats.timeMinutes)
                                NutritionGauge.difficulty(stats.difficulty)
                                NutritionGauge.health(stats.healthScore)
                                NutritionGauge.ingredients(count: stats.ingredientCount)
                            }
                            .padding(.top, AlchemySpacing.sm)

                            Spacer()
                                .frame(height: AlchemySpacing.md)

                            // Open Recipe button — positioned in the lower third
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
