import SwiftUI

struct AlchemyGlassCard<Content: View>: View {
    var padding: CGFloat = Spacing.lg
    var radius: CGFloat = Radius.xl
    @ViewBuilder let content: () -> Content

    var body: some View {
        content()
            .padding(padding)
            .alchemyGlass(radius: radius)
    }
}
