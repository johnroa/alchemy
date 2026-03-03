import SwiftUI

struct SkeletonRect: View {
    var width: CGFloat? = nil
    var height: CGFloat = 16
    var radius: CGFloat = Radius.sm

    var body: some View {
        RoundedRectangle(cornerRadius: radius)
            .fill(AlchemyColors.elevated)
            .frame(width: width, height: height)
            .shimmer()
    }
}

struct SkeletonCircle: View {
    var size: CGFloat = 40

    var body: some View {
        Circle()
            .fill(AlchemyColors.elevated)
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
