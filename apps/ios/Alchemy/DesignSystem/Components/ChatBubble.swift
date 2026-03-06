import SwiftUI

/// iMessage-style chat bubble used in Generate and Onboarding screens.
///
/// User messages appear right-aligned with the accent color background.
/// Assistant messages appear left-aligned with a surface-colored background.
/// Bubble corners are rounded except for the tail corner (bottom-right for user,
/// bottom-left for assistant) to mimic native iOS Messages.
struct ChatBubble: View {
    let message: ChatMessage

    /// Max width as a fraction of screen width — prevents bubbles from spanning full width
    private let maxWidthFraction: CGFloat = 0.78

    private var isUser: Bool { message.role == .user }

    var body: some View {
        HStack {
            if isUser { Spacer(minLength: 40) }

            Text(message.content)
                .font(AlchemyTypography.chatMessage)
                .foregroundStyle(isUser ? .white : AlchemyColors.textPrimary)
                .padding(.horizontal, AlchemySpacing.md)
                .padding(.vertical, AlchemySpacing.sm + 2)
                .background(bubbleBackground)
                .clipShape(bubbleShape)

            if !isUser { Spacer(minLength: 40) }
        }
        .frame(maxWidth: .infinity, alignment: isUser ? .trailing : .leading)
    }

    private var bubbleBackground: Color {
        isUser ? AlchemyColors.accent : AlchemyColors.surfaceSecondary
    }

    /// Asymmetric rounded corners to create the message tail effect.
    /// User bubbles have a squared bottom-right corner.
    /// Assistant bubbles have a squared bottom-left corner.
    private var bubbleShape: UnevenRoundedRectangle {
        let r: CGFloat = 18
        let tail: CGFloat = 4
        if isUser {
            return UnevenRoundedRectangle(
                topLeadingRadius: r,
                bottomLeadingRadius: r,
                bottomTrailingRadius: tail,
                topTrailingRadius: r
            )
        } else {
            return UnevenRoundedRectangle(
                topLeadingRadius: r,
                bottomLeadingRadius: tail,
                bottomTrailingRadius: r,
                topTrailingRadius: r
            )
        }
    }
}
