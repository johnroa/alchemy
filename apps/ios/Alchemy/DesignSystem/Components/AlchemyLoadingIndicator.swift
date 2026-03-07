import Lottie
import SwiftUI

/// Shared Lottie loading indicator used across major full-screen loading states.
///
/// Keeping the animation sizing in one place prevents visual jumps when the app
/// transitions between launch/auth/onboarding/cookbook loaders. `scaledToFit()`
/// preserves the JSON animation's aspect ratio while the fixed square frame keeps
/// the perceived size identical across screens.
struct AlchemyLoadingIndicator: View {
    var size: CGFloat = 120

    var body: some View {
        LottieView(animation: .named("alchemy-loading"))
            .playing(loopMode: .loop)
            .scaledToFit()
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}
