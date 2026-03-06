import SwiftUI

/// Spacing scale for consistent layout across the app.
///
/// Based on a 4pt base unit. Using named constants prevents magic numbers
/// and makes it easy to adjust the entire app's density.
enum AlchemySpacing {
    /// 4pt — tight internal padding (icon-to-label gaps)
    static let xs: CGFloat = 4

    /// 8pt — compact spacing (between related elements)
    static let sm: CGFloat = 8

    /// 12pt — default internal padding
    static let md: CGFloat = 12

    /// 16pt — standard padding (screen edges, card padding)
    static let lg: CGFloat = 16

    /// 24pt — section gaps
    static let xl: CGFloat = 24

    /// 32pt — major section separators
    static let xxl: CGFloat = 32

    /// 48pt — screen-level vertical spacing
    static let xxxl: CGFloat = 48

    // MARK: - Specific Layout

    /// Horizontal screen edge inset
    static let screenHorizontal: CGFloat = 16

    /// Grid spacing between cookbook cards
    static let gridSpacing: CGFloat = 12

    /// Corner radius for recipe cards
    static let cardRadius: CGFloat = 16

    /// Corner radius for buttons and inputs
    static let buttonRadius: CGFloat = 12

    /// Corner radius for the glass input bar
    static let inputBarRadius: CGFloat = 24

    /// Minimum touch target as per Apple HIG
    static let minTouchTarget: CGFloat = 44
}
