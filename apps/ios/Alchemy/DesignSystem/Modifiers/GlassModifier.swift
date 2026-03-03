import SwiftUI

struct GlassModifier: ViewModifier {
    var radius: CGFloat = Radius.lg
    var opacity: Double = 0.08

    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content
                .glassEffect(.regular.tint(AlchemyColors.card.opacity(0.3)), in: .rect(cornerRadius: radius))
        } else {
            content
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: radius))
                .overlay(
                    RoundedRectangle(cornerRadius: radius)
                        .stroke(Color.white.opacity(opacity), lineWidth: 0.5)
                )
        }
    }
}

struct GlassCapsuleModifier: ViewModifier {
    var opacity: Double = 0.08

    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content
                .glassEffect(.regular.tint(AlchemyColors.card.opacity(0.3)), in: .capsule)
        } else {
            content
                .background(.ultraThinMaterial, in: Capsule())
                .overlay(
                    Capsule()
                        .stroke(Color.white.opacity(opacity), lineWidth: 0.5)
                )
        }
    }
}

extension View {
    func alchemyGlass(radius: CGFloat = Radius.lg) -> some View {
        modifier(GlassModifier(radius: radius))
    }

    func alchemyGlassCapsule() -> some View {
        modifier(GlassCapsuleModifier())
    }
}
