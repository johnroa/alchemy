import SwiftUI

enum AlchemyButtonVariant {
    case primary
    case secondary
    case danger
    case ghost
}

struct AlchemyButton: View {
    let title: String
    var icon: String?
    var variant: AlchemyButtonVariant = .primary
    var isLoading: Bool = false
    var isFullWidth: Bool = true
    var height: CGFloat = Sizing.buttonHeight
    let action: () -> Void

    private var backgroundColor: Color {
        switch variant {
        case .primary: AlchemyColors.grey4
        case .secondary: AlchemyColors.dark
        case .danger: AlchemyColors.danger
        case .ghost: .clear
        }
    }

    private var foregroundColor: Color {
        switch variant {
        case .primary: AlchemyColors.dark
        case .secondary: AlchemyColors.textPrimary
        case .danger: .white
        case .ghost: AlchemyColors.gold
        }
    }

    private var borderColor: Color {
        switch variant {
        case .ghost: AlchemyColors.gold.opacity(0.3)
        case .secondary: AlchemyColors.borderMuted
        default: .clear
        }
    }

    var body: some View {
        Button(action: {
            Haptics.fire(variant == .danger ? .warning : .medium)
            action()
        }) {
            HStack(spacing: Spacing.sm) {
                if isLoading {
                    ProgressView()
                        .tint(foregroundColor)
                        .scaleEffect(0.85)
                } else {
                    if let icon {
                        Image(systemName: icon)
                            .font(.system(size: 16, weight: .semibold))
                    }
                    Text(title)
                        .font(AlchemyFont.bodyBold)
                }
            }
            .frame(maxWidth: isFullWidth ? .infinity : nil)
            .frame(height: height)
            .background(backgroundColor)
            .foregroundStyle(foregroundColor)
            .clipShape(RoundedRectangle(cornerRadius: Radius.md))
            .overlay(
                RoundedRectangle(cornerRadius: Radius.md)
                    .stroke(borderColor, lineWidth: 1)
            )
        }
        .buttonStyle(HapticButtonStyle(haptic: .light))
        .disabled(isLoading)
        .opacity(isLoading ? 0.7 : 1.0)
    }
}

#if DEBUG
#Preview("Buttons") {
    VStack(spacing: 16) {
        AlchemyButton(title: "Primary", icon: "sparkles") {}
        AlchemyButton(title: "Secondary", icon: "bookmark", variant: .secondary) {}
        AlchemyButton(title: "Danger", icon: "trash", variant: .danger) {}
        AlchemyButton(title: "Ghost", icon: "arrow.right", variant: .ghost) {}
        AlchemyButton(title: "Loading...", isLoading: true) {}
    }
    .padding()
    .background(AlchemyColors.deepDark)
    .preferredColorScheme(.dark)
}
#endif
