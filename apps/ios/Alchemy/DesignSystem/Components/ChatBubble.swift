import SwiftUI

/// Chat bubble used in Sous Chef and Onboarding screens.
///
/// Designed to sit on the light holographic mesh gradient:
/// - **Assistant messages**: no background — dark text floats directly on the
///   gradient with a subtle white drop shadow for readability. Left-aligned.
/// - **User messages**: dark translucent background (black @ 70% opacity) with
///   white text. Right-aligned with iMessage-style asymmetric corners.
/// - **System messages**: center-aligned notification cards with a subtle
///   accent tint, used for inline "Preferences Saved!" feedback.
/// - **Loading state**: animated chef phrase with shimmer + cycling periods.
struct ChatBubble: View {
    let message: ChatMessage

    /// Max width as a fraction of screen width — prevents bubbles from spanning full width
    private let maxWidthFraction: CGFloat = 0.78

    private var isUser: Bool { message.role == .user }
    private var isSystem: Bool { message.role == .system }

    var body: some View {
        if isSystem {
            systemBubble
        } else {
            standardBubble
        }
    }

    private var standardBubble: some View {
        HStack {
            if isUser { Spacer(minLength: 40) }

            if message.isLoading {
                ChefLoadingBubble()
                    .padding(.horizontal, AlchemySpacing.md)
                    .padding(.vertical, AlchemySpacing.sm + 2)
            } else if isUser {
                Text(message.content)
                    .font(AlchemyTypography.chatMessage)
                    .foregroundStyle(.white)
                    .padding(.horizontal, AlchemySpacing.md)
                    .padding(.vertical, AlchemySpacing.sm + 2)
                    .background(Color.black.opacity(0.45))
                    .clipShape(bubbleShape)
            } else {
                Text(message.content)
                    .font(AlchemyTypography.chatMessage)
                    .foregroundStyle(Color(red: 0.12, green: 0.12, blue: 0.14))
                    .shadow(color: .white.opacity(0.6), radius: 3, x: 0, y: 1)
                    .padding(.horizontal, AlchemySpacing.md)
                    .padding(.vertical, AlchemySpacing.sm + 2)
            }

            if !isUser { Spacer(minLength: 40) }
        }
        .frame(maxWidth: .infinity, alignment: isUser ? .trailing : .leading)
    }

    /// Center-aligned notification card for system events like preference saves.
    /// Uses a compact pill shape with a sparkles icon and subtle accent background.
    private var systemBubble: some View {
        HStack(spacing: 6) {
            Image(systemName: "sparkles")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(AlchemyColors.accent)
            Text(message.content)
                .font(AlchemyTypography.caption.weight(.medium))
                .foregroundStyle(Color(red: 0.2, green: 0.2, blue: 0.25))
        }
        .padding(.horizontal, AlchemySpacing.md)
        .padding(.vertical, AlchemySpacing.xs + 2)
        .background(AlchemyColors.accent.opacity(0.12))
        .clipShape(Capsule())
        .frame(maxWidth: .infinity, alignment: .center)
    }

    /// Asymmetric rounded corners for the user bubble tail effect.
    /// Squared bottom-right corner mimics native iOS Messages.
    private var bubbleShape: UnevenRoundedRectangle {
        let r: CGFloat = 18
        let tail: CGFloat = 4
        return UnevenRoundedRectangle(
            topLeadingRadius: r,
            bottomLeadingRadius: r,
            bottomTrailingRadius: tail,
            topTrailingRadius: r
        )
    }
}

// MARK: - Chef Loading Bubble

/// Animated loading indicator that cycles through fun chef phrases
/// with an animated period trail ("Sautéing.", "Sautéing..", "Sautéing...")
/// and a horizontal shimmer sweep.
struct ChefLoadingBubble: View {
    /// Phrases rotate every 2.5s so the user sees variety during longer waits.
    private static let phrases = [
        "Cooking",
        "Sautéing",
        "Whisking",
        "Simmering",
        "Plating",
        "Seasoning",
        "Tasting",
        "Marinating",
        "Braising",
        "Dicing",
        "Folding",
        "Reducing",
        "Caramelizing",
        "Blanching",
    ]

    @State private var phraseIndex = Int.random(in: 0..<phrases.count)
    @State private var dotCount = 1
    @State private var shimmerOffset: CGFloat = -1.0

    /// Dot animation ticks at 0.4s intervals: "." → ".." → "..." → "." …
    private let dotTimer = Timer.publish(every: 0.4, on: .main, in: .common).autoconnect()
    /// Phrase rotation timer — cycles to a new random phrase every 2.5s.
    private let phraseTimer = Timer.publish(every: 2.5, on: .main, in: .common).autoconnect()

    private var displayText: String {
        Self.phrases[phraseIndex % Self.phrases.count] + String(repeating: ".", count: dotCount)
    }

    var body: some View {
        Text(displayText)
            .font(AlchemyTypography.chatMessage.italic())
            .foregroundStyle(Color(red: 0.25, green: 0.25, blue: 0.30))
            .shadow(color: .white.opacity(0.5), radius: 2, x: 0, y: 1)
            // Extra bottom space so italic descenders (g, y, p) aren't clipped
            // by the shimmer overlay's GeometryReader-based mask.
            .padding(.bottom, 3)
            .overlay { shimmerOverlay }
            .onReceive(dotTimer) { _ in
                withAnimation(.easeInOut(duration: 0.15)) {
                    dotCount = (dotCount % 3) + 1
                }
            }
            .onReceive(phraseTimer) { _ in
                withAnimation(.easeInOut(duration: 0.3)) {
                    phraseIndex = (phraseIndex + 1) % Self.phrases.count
                    dotCount = 1
                }
            }
            .onAppear {
                withAnimation(
                    .linear(duration: 1.8)
                    .repeatForever(autoreverses: false)
                ) {
                    shimmerOffset = 2.0
                }
            }
    }

    /// Horizontal shimmer sweep — a bright highlight sliding left to right.
    private var shimmerOverlay: some View {
        GeometryReader { geo in
            let w = geo.size.width
            Rectangle()
                .fill(
                    LinearGradient(
                        colors: [.clear, .white.opacity(0.6), .clear],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                )
                .frame(width: w * 0.4)
                .offset(x: shimmerOffset * w)
                .blendMode(.softLight)
        }
        .mask {
            Text(displayText)
                .font(AlchemyTypography.chatMessage.italic())
                .padding(.bottom, 3)
        }
        .allowsHitTesting(false)
    }
}
