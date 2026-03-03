import SwiftUI

struct ProfileQuickMenu: View {
    var onPreferences: () -> Void
    var onSettings: () -> Void

    @State private var sheenOffset: CGFloat = -220

    var body: some View {
        VStack(spacing: 14) {
            menuButton(title: "Preferences", action: onPreferences)
            menuButton(title: "Settings", action: onSettings)
        }
        .padding(14)
        .frame(width: 282)
        .background(
            RoundedRectangle(cornerRadius: 34, style: .continuous)
                .fill(Color(hex: 0x08253B).opacity(0.86))
                .background(
                    RoundedRectangle(cornerRadius: 34, style: .continuous)
                        .fill(.ultraThinMaterial)
                        .opacity(0.6)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 34, style: .continuous)
                        .stroke(Color(hex: 0x0C74B4).opacity(0.55), lineWidth: 1)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 34, style: .continuous)
                        .fill(
                            LinearGradient(
                                colors: [
                                    .clear,
                                    Color.white.opacity(0.22),
                                    .clear
                                ],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .offset(x: sheenOffset)
                        .blur(radius: 8)
                        .mask(
                            RoundedRectangle(cornerRadius: 34, style: .continuous)
                        )
                )
        )
        .shadow(color: Color.black.opacity(0.38), radius: 24, x: 0, y: 12)
        .onAppear {
            withAnimation(.easeOut(duration: 0.5)) {
                sheenOffset = 220
            }
        }
    }

    private func menuButton(title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 19, weight: .semibold))
                .foregroundStyle(AlchemyColors.textPrimary)
                .frame(maxWidth: .infinity)
                .frame(height: 64)
                .background(
                    Capsule()
                        .fill(Color(hex: 0x2D4558).opacity(0.95))
                        .overlay(
                            Capsule()
                                .stroke(Color.white.opacity(0.14), lineWidth: 0.8)
                        )
                )
        }
        .buttonStyle(.plain)
    }
}

