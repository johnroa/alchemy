import SwiftUI

/// Typography system for Alchemy.
///
/// Uses system serif for display/titles (warm, editorial feel for a food app)
/// and system sans-serif for body/UI text (clarity and legibility).
/// All sizes are optimized for the dark-mode, image-heavy design.
enum AlchemyTypography {

    // MARK: - Display (Serif)
    // Used for recipe titles, hero text, and large headings.
    // Georgia or system serif gives an editorial cookbook feel.

    /// Large display title — recipe hero, splash screen
    static let displayLarge = Font.system(.largeTitle, design: .serif, weight: .bold)

    /// Medium display — section headers on detail pages
    static let displayMedium = Font.system(.title, design: .serif, weight: .bold)

    /// Small display — card titles, modal headings
    static let displaySmall = Font.system(.title2, design: .serif, weight: .semibold)

    // MARK: - Headings (Sans-serif)

    /// Screen titles — "Cookbook", "Explore", navigation headers
    static let heading = Font.system(.title2, design: .default, weight: .bold)

    /// Sub-headings — section labels within a screen
    static let subheading = Font.system(.headline, design: .default, weight: .semibold)

    // MARK: - Body

    /// Primary body text — recipe steps, descriptions, chat messages
    static let body = Font.system(.body, design: .default, weight: .regular)

    /// Secondary body — ingredient names, metadata
    static let bodySecondary = Font.system(.subheadline, design: .default, weight: .regular)

    // MARK: - Supporting

    /// Captions — timestamps, image status labels
    static let caption = Font.system(.caption, design: .default, weight: .regular)

    /// Bold caption — ingredient quantities, stat labels
    static let captionBold = Font.system(.caption, design: .default, weight: .semibold)

    /// Tab bar labels and small UI controls
    static let tabLabel = Font.system(.caption2, design: .default, weight: .medium)

    // MARK: - Ingredient Table

    /// Ingredient name in the detail view table
    static let ingredientName = Font.system(.body, design: .default, weight: .regular)

    /// Ingredient quantity — right-aligned, bold for scanability
    static let ingredientQuantity = Font.system(.body, design: .default, weight: .semibold)

    // MARK: - Chat

    /// Chat message text
    static let chatMessage = Font.system(.body, design: .default, weight: .regular)

    /// Chat input placeholder
    static let chatPlaceholder = Font.system(.body, design: .default, weight: .regular)
}
