import SwiftUI
import NukeUI

/// Explore screen — discovery feed with full-bleed swipeable recipe cards.
///
/// Layout (top to bottom):
/// 1. "Explore" header with ProfileMenu
/// 2. Horizontal scroll of Liquid Glass filter chips
/// 3. Full-bleed paging card carousel — large hero images extending to bottom,
///    title + description overlaid. Swipe left/right with paging snap.
/// 4. Floating single-line GlassInputBar for natural language search ("romantic dinner")
/// 5. Liquid Glass tab bar (native, from TabShell)
///
/// Tapping a card navigates to RecipeDetailView with "Add to Cookbook" and "Edit" actions.
struct ExploreView: View {
    @State private var selectedFilter = "All"
    @State private var searchText = ""
    @State private var selectedCard: RecipeCard? = nil
    @State private var showPreferences = false
    @State private var showSettings = false

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottom) {
                VStack(spacing: 0) {
                    // Filter chips
                    filterChips

                    // Card carousel
                    cardCarousel
                }

                // Floating search bar just above the tab bar
                GlassInputBar(
                    placeholder: "Search for inspiration...",
                    text: $searchText,
                    onSubmit: {
                        // Will filter explore cards via API or local filter
                    }
                )
                .padding(.bottom, AlchemySpacing.xxl + AlchemySpacing.xxxl)
            }
            .background(AlchemyColors.background)
            .navigationTitle("Explore")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    ProfileMenu(
                        onPreferences: { showPreferences = true },
                        onSettings: { showSettings = true }
                    )
                }
            }
            .navigationDestination(item: $selectedCard) { card in
                RecipeDetailView(
                    recipe: PreviewData.sampleRecipe,
                    showAddToCookbook: true
                )
            }
            .sheet(isPresented: $showPreferences) { PreferencesView() }
            .sheet(isPresented: $showSettings) { SettingsView() }
        }
    }

    // MARK: - Filter Chips

    /// Horizontal scroll of Liquid Glass filter chips.
    /// Active chip gets `.regular` glass, inactive gets `.clear`.
    private var filterChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: AlchemySpacing.sm) {
                ForEach(PreviewData.exploreFilters, id: \.self) { filter in
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
            .padding(.vertical, AlchemySpacing.sm)
        }
    }

    // MARK: - Card Carousel

    /// Full-bleed paging carousel of recipe cards.
    /// Each card is a large hero image extending nearly to the bottom of the screen,
    /// with title and description overlaid at the bottom.
    /// Uses TabView with .page style for native paging snap behavior.
    private var cardCarousel: some View {
        TabView {
            ForEach(PreviewData.exploreCards) { card in
                ExploreCardView(card: card) {
                    selectedCard = card
                }
            }
        }
        .tabViewStyle(.page(indexDisplayMode: .automatic))
    }
}

/// Individual explore card — full-bleed hero image with overlaid text.
///
/// The image extends edge-to-edge with a gradient at the bottom for text readability.
/// Title in serif display font, summary in body, with an "Explore" button.
private struct ExploreCardView: View {
    let card: RecipeCard
    let onTap: () -> Void

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .bottomLeading) {
                // Full-bleed image
                LazyImage(url: card.imageURL) { state in
                    if let image = state.image {
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                    } else if state.error != nil {
                        Rectangle().fill(AlchemyColors.surfaceSecondary)
                    } else {
                        Rectangle()
                            .fill(AlchemyColors.surfaceSecondary)
                            .overlay { ProgressView().tint(AlchemyColors.textTertiary) }
                    }
                }
                .frame(width: geo.size.width, height: geo.size.height)
                .clipped()

                // Gradient for text readability
                AlchemyColors.heroGradient

                // Text content at bottom
                VStack(alignment: .leading, spacing: AlchemySpacing.sm) {
                    Text(card.title)
                        .font(AlchemyTypography.displayLarge)
                        .foregroundStyle(.white)
                        .shadow(color: .black.opacity(0.5), radius: 6, x: 0, y: 2)

                    Text(card.summary)
                        .font(AlchemyTypography.body)
                        .foregroundStyle(.white.opacity(0.85))
                        .lineLimit(2)
                        .shadow(color: .black.opacity(0.3), radius: 4, x: 0, y: 1)
                }
                .padding(.horizontal, AlchemySpacing.screenHorizontal)
                .padding(.bottom, 140) // space for search bar + tab bar
            }
            .contentShape(Rectangle())
            .onTapGesture { onTap() }
        }
        .clipShape(RoundedRectangle(cornerRadius: AlchemySpacing.cardRadius))
        .padding(.horizontal, AlchemySpacing.sm)
    }
}
