import SwiftUI

struct ShimmerModifier: ViewModifier {
    @State private var phase: CGFloat = -1.0

    func body(content: Content) -> some View {
        content
            .overlay(
                GeometryReader { geo in
                    LinearGradient(
                        colors: [
                            .clear,
                            Color.white.opacity(0.018),
                            Color.white.opacity(0.045),
                            Color.white.opacity(0.018),
                            .clear
                        ],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                    .frame(width: geo.size.width * 0.46)
                    .offset(x: geo.size.width * phase)
                    .blur(radius: 4)
                    .opacity(0.75)
                }
            )
            .clipShape(RoundedRectangle(cornerRadius: Radius.md))
            .onAppear {
                withAnimation(
                    .linear(duration: 2.4)
                    .repeatForever(autoreverses: false)
                ) {
                    phase = 1.8
                }
            }
    }
}

extension View {
    func shimmer() -> some View {
        modifier(ShimmerModifier())
    }
}
