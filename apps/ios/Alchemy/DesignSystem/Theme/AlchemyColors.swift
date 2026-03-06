import SwiftUI

/// Dark-only color palette for Alchemy.
///
/// Naming convention: semantic purpose, not visual description.
/// The palette uses deep navy/charcoal backgrounds with warm amber accents
/// to evoke a premium kitchen atmosphere.
enum AlchemyColors {

    // MARK: - Backgrounds

    /// Primary app background — solid black
    static let background = Color.black

    /// Elevated surface (cards, modals) — slightly lighter than background
    static let surface = Color(red: 0.11, green: 0.11, blue: 0.14)

    /// Subtle surface for grouped content and secondary panels
    static let surfaceSecondary = Color(red: 0.15, green: 0.15, blue: 0.18)

    // MARK: - Text

    /// Primary text — warm white, not pure white to reduce eye strain
    static let textPrimary = Color(red: 0.95, green: 0.93, blue: 0.90)

    /// Secondary text — muted cream for subtitles and metadata
    static let textSecondary = Color(red: 0.65, green: 0.63, blue: 0.60)

    /// Tertiary text — low emphasis labels and placeholders
    static let textTertiary = Color(red: 0.45, green: 0.43, blue: 0.40)

    // MARK: - Accent

    /// Warm amber accent for CTAs, highlights, and active states
    static let accent = Color(red: 0.925, green: 0.580, blue: 0.290)

    /// Muted accent for secondary interactive elements
    static let accentMuted = Color(red: 0.925, green: 0.580, blue: 0.290).opacity(0.6)

    // MARK: - Semantic

    /// Separator lines — very subtle horizontal rules
    static let separator = Color.white.opacity(0.08)

    /// Overlay for glass modals and blurred backgrounds
    static let overlay = Color.black.opacity(0.6)

    /// Card gradient overlay for text readability on images
    static let cardGradient = LinearGradient(
        colors: [.clear, Color.black.opacity(0.7)],
        startPoint: .center,
        endPoint: .bottom
    )

    /// Hero image gradient for recipe detail title readability
    static let heroGradient = LinearGradient(
        colors: [.clear, .clear, Color.black.opacity(0.8)],
        startPoint: .top,
        endPoint: .bottom
    )
}
