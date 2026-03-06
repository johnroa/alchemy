import SwiftUI
import NukeUI

/// Recipe card for the Cookbook masonry grid.
///
/// Full-bleed image contained within a fixed-height rounded rectangle, with a dark
/// overlay for readability and text overlaid at the bottom with drop shadows.
///
/// Each card gets a deterministic "random" height based on its ID to create a
/// Pinterest-style staggered/masonry effect.
///
/// Key layout constraint: the entire card is wrapped in a GeometryReader-free
/// fixed frame. The image uses .fill + .clipped so it covers the card area
/// without blowing out the parent width.
struct RecipeCardView: View {
    let card: RecipeCard

    /// Optional explicit height override (used in context menu previews).
    var fixedHeight: CGFloat? = nil

    /// Height range for the staggered masonry effect
    private static let minHeight: CGFloat = 180
    private static let maxHeight: CGFloat = 280

    /// Deterministic height from the card's ID — stable across re-renders
    private var staggeredHeight: CGFloat {
        let hash = abs(card.id.hashValue)
        let normalized = CGFloat(hash % 100) / 100.0
        return Self.minHeight + normalized * (Self.maxHeight - Self.minHeight)
    }

    private var cardHeight: CGFloat {
        fixedHeight ?? staggeredHeight
    }

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            // Image layer — fills the card bounds and clips to prevent overflow
            LazyImage(url: card.imageURL) { state in
                if let image = state.image {
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                } else if state.error != nil {
                    imagePlaceholder
                } else {
                    Rectangle()
                        .fill(AlchemyColors.surfaceSecondary)
                        .overlay {
                            ProgressView()
                                .tint(AlchemyColors.textTertiary)
                        }
                }
            }
            // Pin to exact card size — .fill will overflow, frame + clipped contain it
            .frame(minWidth: 0, maxWidth: .infinity, minHeight: cardHeight, maxHeight: cardHeight)
            .clipped()

            // Darker overlay — 50% opacity for strong text contrast
            Color.black.opacity(0.50)

            // Bottom gradient for extra text area contrast
            LinearGradient(
                colors: [.clear, .black.opacity(0.5)],
                startPoint: .center,
                endPoint: .bottom
            )

            // Text content — constrained to card width with shadow for depth
            VStack(alignment: .leading, spacing: 2) {
                Text(card.title)
                    .font(AlchemyTypography.displaySmall)
                    .foregroundStyle(.white)
                    .lineLimit(2)
                    .shadow(color: .black.opacity(0.7), radius: 4, x: 0, y: 2)

                Text(card.summary)
                    .font(AlchemyTypography.caption)
                    .foregroundStyle(.white.opacity(0.85))
                    .lineLimit(1)
                    .shadow(color: .black.opacity(0.5), radius: 2, x: 0, y: 1)
            }
            .padding(AlchemySpacing.md)
        }
        .frame(height: cardHeight)
        .clipShape(RoundedRectangle(cornerRadius: AlchemySpacing.cardRadius))
        .contentShape(RoundedRectangle(cornerRadius: AlchemySpacing.cardRadius))
    }

    private var imagePlaceholder: some View {
        Rectangle()
            .fill(AlchemyColors.surfaceSecondary)
            .overlay {
                Image(systemName: "photo")
                    .font(.title)
                    .foregroundStyle(AlchemyColors.textTertiary)
            }
    }
}
