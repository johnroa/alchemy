import SwiftUI

struct SplashView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var wordmarkOpacity: Double = 0
    @State private var wordmarkOffset: CGFloat = 8

    var body: some View {
        ZStack {
            Image("intro-bg")
                .resizable()
                .aspectRatio(contentMode: .fill)
                .ignoresSafeArea()

            AlchemyColors.introGradient
            .ignoresSafeArea()

            VStack(spacing: Spacing.sm) {
                Text("alchemy")
                    .font(.system(size: 64, weight: .light, design: .default))
                    .foregroundStyle(AlchemyColors.textPrimary)
                    .tracking(-1.2)
                    .underline(true, color: AlchemyColors.textPrimary)

                Text("COOKING WITH A.I.")
                    .font(AlchemyFont.body)
                    .foregroundStyle(AlchemyColors.grey3)
                    .tracking(2)
            }
            .opacity(wordmarkOpacity)
            .offset(y: wordmarkOffset)
        }
        .background(AlchemyColors.deepDark)
        .onAppear {
            if reduceMotion {
                wordmarkOpacity = 1
                wordmarkOffset = 0
            } else {
                withAnimation(.easeOut(duration: 0.8).delay(0.2)) {
                    wordmarkOpacity = 1
                    wordmarkOffset = 0
                }
            }
        }
    }
}

#if DEBUG
#Preview("Splash") {
    SplashView()
        .preferredColorScheme(.dark)
}
#endif
