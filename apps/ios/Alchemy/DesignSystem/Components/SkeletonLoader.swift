import SwiftUI

struct SkeletonRect: View {
    var width: CGFloat? = nil
    var height: CGFloat = 16
    var radius: CGFloat = Radius.sm

    var body: some View {
        RoundedRectangle(cornerRadius: radius)
            .fill(AlchemyColors.elevated.opacity(0.52))
            .overlay(
                RoundedRectangle(cornerRadius: radius)
                    .stroke(AlchemyColors.borderMuted.opacity(0.45), lineWidth: 0.6)
            )
            .frame(width: width, height: height)
            .shimmer()
    }
}

struct SkeletonCircle: View {
    var size: CGFloat = 40

    var body: some View {
        Circle()
            .fill(AlchemyColors.elevated.opacity(0.5))
            .overlay(
                Circle()
                    .stroke(AlchemyColors.borderMuted.opacity(0.42), lineWidth: 0.6)
            )
            .frame(width: size, height: size)
            .shimmer()
    }
}

/// Full recipe card skeleton for cookbook grid
struct RecipeCardSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            SkeletonRect(height: 180, radius: Radius.lg)
            SkeletonRect(width: 120, height: 14)
            SkeletonRect(height: 12)
        }
    }
}
