import SwiftUI

extension Color {
    init(hex: UInt, alpha: Double = 1.0) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255.0,
            green: Double((hex >> 8) & 0xFF) / 255.0,
            blue: Double(hex & 0xFF) / 255.0,
            opacity: alpha
        )
    }
}

enum AlchemyColors {
    // MARK: - Figma Backgrounds
    static let deepDark = Color(hex: 0x060F1A)
    static let dark = Color(hex: 0x1B2837)
    static let card = Color(hex: 0x1B2837)
    static let elevated = Color(hex: 0x22364A)
    static let tabGlass = Color.white.opacity(0.2)

    // MARK: - Accent
    static let gold = Color(hex: 0xC8A97E)
    static let goldLight = Color(hex: 0xE8D5B5)
    static let goldDark = Color(hex: 0x9A7B52)

    // MARK: - Greys
    static let grey1 = Color(hex: 0x626E7B)
    static let grey2 = Color(hex: 0xB6BCC3)
    static let grey3 = Color(hex: 0xD4D8DD)
    static let grey4 = Color(hex: 0xF1F3F6)

    // MARK: - Semantic
    static let success = Color(hex: 0x1F9D73)
    static let danger = Color(hex: 0xF87171)
    static let warning = Color(hex: 0xF59E0B)
    static let info = Color(hex: 0x60A5FA)

    // MARK: - Specialty
    static let skyBlue = Color(hex: 0xDBE8EB)
    static let borderSubtle = Color.white.opacity(0.2)
    static let borderMuted = Color.white.opacity(0.08)
    static let borderStrong = Color(hex: 0x4750C9)
    static let overlayDark = Color.black.opacity(0.66)

    // MARK: - Text
    static let textPrimary = Color.white
    static let textSecondary = Color(hex: 0xB6BCC3)
    static let textTertiary = Color(hex: 0x626E7B)
    static let textInverse = Color(hex: 0x060F1A)

    // MARK: - Gradients
    static let heroGradient = LinearGradient(
        colors: [.clear, deepDark.opacity(0.6), deepDark],
        startPoint: .top,
        endPoint: .bottom
    )

    static let cardGradient = LinearGradient(
        colors: [.clear, Color.black.opacity(0.7)],
        startPoint: .center,
        endPoint: .bottom
    )

    static let goldGradient = LinearGradient(
        colors: [goldLight, gold, goldDark],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    static let warmGradient = LinearGradient(
        colors: [Color(hex: 0x2A1F14), Color(hex: 0x1A1208)],
        startPoint: .top,
        endPoint: .bottom
    )

    static let introGradient = LinearGradient(
        colors: [deepDark.opacity(0.95), deepDark.opacity(0.45), .clear],
        startPoint: .bottom,
        endPoint: .top
    )

    static let chatPanelGradient = LinearGradient(
        colors: [Color(hex: 0x0A3B61).opacity(0.5), deepDark.opacity(0.92)],
        startPoint: .top,
        endPoint: .bottom
    )
}
