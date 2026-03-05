import SwiftUI

enum Spacing {
    static let xs: CGFloat = 4
    static let sm: CGFloat = 8
    static let sm2: CGFloat = 12
    static let md: CGFloat = 16
    static let lg2: CGFloat = 20
    static let lg: CGFloat = 24
    static let xl: CGFloat = 32
    static let xxl: CGFloat = 36
    static let xxxl: CGFloat = 48
}

enum Radius {
    static let sm: CGFloat = 8
    static let md: CGFloat = 12
    static let lg: CGFloat = 16
    static let xl: CGFloat = 24
    static let xxl: CGFloat = 32
    static let pill: CGFloat = 999
}

enum Sizing {
    /// Minimum touch target per Apple HIG
    static let touchTarget: CGFloat = 44
    /// Standard button height
    static let buttonHeight: CGFloat = 64
    /// Large button height
    static let buttonHeightLG: CGFloat = 64
    /// Text field height
    static let fieldHeight: CGFloat = 64
    /// Large text field height
    static let fieldHeightLG: CGFloat = 64
    /// Search bar height
    static let searchBarHeight: CGFloat = 56
    /// Tab bar total height
    static let tabBarHeight: CGFloat = 64
    /// Standard top header row height
    static let headerRowHeight: CGFloat = 52
    /// Standard header top inset from safe area
    static let headerTopInset: CGFloat = 24
    /// Recipe card aspect ratio
    static let recipeCardAspect: CGFloat = 0.78
}
