import SwiftUI

struct AuthFlowView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var showRegister = false

    var body: some View {
        ZStack {
            // Full-bleed background
            Image("intro-bg")
                .resizable()
                .aspectRatio(contentMode: .fill)
                .ignoresSafeArea()

            LinearGradient(
                colors: [
                    Color.black.opacity(0.2),
                    AlchemyColors.deepDark.opacity(0.75),
                    AlchemyColors.deepDark.opacity(0.98)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            Group {
                if showRegister {
                    RegisterView(showRegister: $showRegister)
                        .transition(.asymmetric(
                            insertion: .move(edge: .trailing).combined(with: .opacity),
                            removal: .move(edge: .leading).combined(with: .opacity)
                        ))
                } else {
                    SignInView(showRegister: $showRegister)
                        .transition(.asymmetric(
                            insertion: .move(edge: .leading).combined(with: .opacity),
                            removal: .move(edge: .trailing).combined(with: .opacity)
                        ))
                }
            }
            .animation(reduceMotion ? .none : .spring(response: 0.45, dampingFraction: 0.85), value: showRegister)
        }
    }
}
