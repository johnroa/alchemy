import SwiftUI
import NukeUI

/// Full recipe detail view with hero image, sticky scroll title, ingredient table,
/// steps, and floating tweak chat bar.
///
/// Scroll behavior:
/// 1. Hero image (40% screen height) with recipe title at bottom in serif + drop shadow
/// 2. On scroll, hero compresses upward
/// 3. When title reaches the nav bar, it pins as a sticky header
/// 4. Title + a sliver of the hero remain visible as user scrolls through content
///
/// The bottom tab bar is hidden (this is a pushed detail view) and replaced with
/// a floating GlassInputBar for tweaking: "Want to tweak this recipe?"
///
/// Navigation header: back button (top-left), share button, user icon (top-right)
struct RecipeDetailView: View {
    let recipe: Recipe

    /// Whether this view should show "Add to Cookbook" action (used from Explore/Generate)
    var showAddToCookbook: Bool = false

    @State private var tweakText = ""
    @State private var showTweakChat = false
    @Environment(\.dismiss) private var dismiss

    /// Tracks scroll offset to determine when to pin the title
    @State private var heroHeight: CGFloat = 0
    @State private var scrollOffset: CGFloat = 0

    /// Height of the hero image as a fraction of screen height
    private let heroFraction: CGFloat = 0.4

    /// The title becomes "stuck" when the hero has scrolled enough that the title
    /// would leave the screen. This threshold triggers the sticky header.
    private var titleIsPinned: Bool {
        scrollOffset < -(heroHeight - 100)
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            ScrollView {
                VStack(spacing: 0) {
                    // MARK: - Hero Image + Title
                    heroSection

                    // MARK: - Content
                    VStack(alignment: .leading, spacing: AlchemySpacing.xl) {
                        ingredientSection
                        Divider().overlay(AlchemyColors.separator)
                        stepsSection
                    }
                    .padding(.horizontal, AlchemySpacing.screenHorizontal)
                    .padding(.top, AlchemySpacing.xl)
                    .padding(.bottom, 120) // space for floating input bar
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

            // Sticky pinned title that appears when hero scrolls off
            if titleIsPinned {
                stickyTitleBar
                    .transition(.move(edge: .top).combined(with: .opacity))
            }

            // Floating tweak input bar at bottom
            VStack {
                Spacer()
                GlassInputBar(
                    placeholder: "Want to tweak this recipe?",
                    text: $tweakText,
                    onSubmit: {
                        // Will send to POST /chat/{id}/messages for iteration
                        tweakText = ""
                    }
                )
                .padding(.bottom, AlchemySpacing.sm)
            }
        }
        .background(AlchemyColors.background)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                HStack(spacing: AlchemySpacing.sm) {
                    if showAddToCookbook {
                        Button {
                            // Will call POST /recipes/{id}/save
                        } label: {
                            Image(systemName: "bookmark.fill")
                                .foregroundStyle(AlchemyColors.accent)
                        }
                    }

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
        .toolbarVisibility(.hidden, for: .tabBar)
        .animation(.easeInOut(duration: 0.2), value: titleIsPinned)
    }

    // MARK: - Hero Section

    private var heroSection: some View {
        GeometryReader { geo in
            let height = geo.size.height
            ZStack(alignment: .bottomLeading) {
                // Hero image — fills the full width, stretches on over-scroll
                LazyImage(url: recipe.imageURL) { state in
                    if let image = state.image {
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                    } else {
                        Rectangle().fill(AlchemyColors.surfaceSecondary)
                    }
                }
                .frame(width: geo.size.width, height: height)
                .clipped()

                // Gradient overlay for title readability
                AlchemyColors.heroGradient

                // Recipe title at bottom of hero
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

    // MARK: - Sticky Title Bar

    /// Pinned title bar that appears at the top when the hero scrolls off screen.
    /// Shows a sliver of the hero gradient + the recipe title.
    private var stickyTitleBar: some View {
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

    /// Clean ingredient table with horizontal rules only.
    /// Name left-aligned, quantity right-aligned and bold.
    private var ingredientSection: some View {
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
                        Text(ingredient.name)
                            .font(AlchemyTypography.ingredientName)
                            .foregroundStyle(AlchemyColors.textPrimary)

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

    private var stepsSection: some View {
        VStack(alignment: .leading, spacing: AlchemySpacing.lg) {
            Text("Steps")
                .font(AlchemyTypography.heading)
                .foregroundStyle(AlchemyColors.textPrimary)

            ForEach(recipe.steps) { step in
                HStack(alignment: .top, spacing: AlchemySpacing.md) {
                    // Step number in a circle
                    Text("\(step.number)")
                        .font(AlchemyTypography.captionBold)
                        .foregroundStyle(AlchemyColors.accent)
                        .frame(width: 28, height: 28)
                        .background(AlchemyColors.accent.opacity(0.15))
                        .clipShape(Circle())

                    Text(step.instruction)
                        .font(AlchemyTypography.body)
                        .foregroundStyle(AlchemyColors.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }
}

/// Preference key to track scroll offset in the coordinate space.
private struct ScrollOffsetKey: PreferenceKey {
    nonisolated(unsafe) static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}
