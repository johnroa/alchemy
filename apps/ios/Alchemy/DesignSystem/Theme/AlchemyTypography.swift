import SwiftUI

/// Typography system for Alchemy.
///
/// Display/titles use Apple's "New York" serif typeface (accessed via the
/// `.serif` design parameter — this IS New York on iOS, no bundling needed).
/// Body/UI text uses system sans-serif (SF Pro) for clarity and legibility.
/// All sizes are optimized for the dark-mode, image-heavy design.
enum AlchemyTypography {

    // MARK: - Display (New York Serif)
    // `.design(.serif)` resolves to Apple's New York typeface on iOS.
    // The system automatically selects the correct optical size variant
    // (Small, Regular, Large, Extra Large) based on the point size.

    /// Large display title — recipe hero, splash screen
    static let displayLarge = Font.system(size: 34, weight: .bold, design: .serif)

    /// Medium display — section headers on detail pages
    static let displayMedium = Font.system(size: 28, weight: .bold, design: .serif)

    /// Small display — card titles, modal headings
    static let displaySmall = Font.system(size: 22, weight: .semibold, design: .serif)

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
