import SwiftUI

/// Dark-only color palette for Alchemy.
///
/// Naming convention: semantic purpose, not visual description.
/// The palette uses solid black backgrounds with pure white accents
/// for a monochrome, Liquid-Glass-forward aesthetic.
enum AlchemyColors {

    // MARK: - Backgrounds

    /// Primary app background — solid black
    static let background = Color.black

    /// Elevated surface (cards, modals) — slightly lighter than background
    static let surface = Color(red: 0.11, green: 0.11, blue: 0.14)

    /// Subtle surface for grouped content and secondary panels
    static let surfaceSecondary = Color(red: 0.15, green: 0.15, blue: 0.18)

    // MARK: - Text

    /// Primary text — pure white
    static let textPrimary = Color.white

    /// Secondary text — medium white for subtitles and metadata
    static let textSecondary = Color.white.opacity(0.6)

    /// Tertiary text — low emphasis labels and placeholders
    static let textTertiary = Color.white.opacity(0.35)

    // MARK: - Accent

    /// Primary accent — clean white. Keeps everything monochrome;
    /// Liquid Glass provides the visual depth.
    static let accent = Color.white

    /// Muted accent for secondary interactive elements
    static let accentMuted = Color.white.opacity(0.6)

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

    /// Hero image gradient for recipe detail title readability.
    /// Kept light so photos stay vibrant; the text shadow on the
    /// title carries most of the contrast work.
    static let heroGradient = LinearGradient(
        colors: [.clear, .clear, Color.black.opacity(0.4)],
        startPoint: .top,
        endPoint: .bottom
    )
}
