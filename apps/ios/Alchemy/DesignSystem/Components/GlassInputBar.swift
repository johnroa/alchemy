import SwiftUI

/// Floating Liquid Glass input bar used across multiple screens:
/// - Cookbook/RecipeDetail: "Want to tweak this recipe?"
/// - Sous Chef: "Give me dinner ideas" / "Want to make any changes?"
/// - Explore: single-line search input
///
/// Uses iOS 26 `.glassEffect()` for the native frosted glass material.
/// The bar floats above content with a subtle shadow and rounded capsule shape.
struct GlassInputBar: View {
    let placeholder: String
    @Binding var text: String
    var onSubmit: (() -> Void)? = nil

    /// When true, the bar expands into a full text input with keyboard.
    /// When false, it shows as a tappable pill with placeholder text.
    @FocusState private var isFocused: Bool

    var body: some View {
        HStack(spacing: AlchemySpacing.sm) {
            TextField(placeholder, text: $text)
                .font(AlchemyTypography.chatPlaceholder)
                .foregroundStyle(AlchemyColors.textPrimary)
                .focused($isFocused)
                .submitLabel(.send)
                .onSubmit {
                    onSubmit?()
                }

            if !text.isEmpty {
                Button {
                    onSubmit?()
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.title2)
                        .foregroundStyle(AlchemyColors.accent)
                }
                .transition(.scale.combined(with: .opacity))
            }
        }
        .padding(.horizontal, AlchemySpacing.lg)
        .padding(.vertical, AlchemySpacing.md)
        .glassEffect(.regular, in: .capsule)
        .padding(.horizontal, AlchemySpacing.screenHorizontal)
        .animation(.easeInOut(duration: 0.2), value: text.isEmpty)
    }
}
