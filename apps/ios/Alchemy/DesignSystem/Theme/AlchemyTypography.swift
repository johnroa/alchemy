import SwiftUI

enum AlchemyFont {
    // MARK: - Display
    static let largeTitle = Font.system(size: 34, weight: .bold, design: .default)
    static let titleXL = largeTitle
    static let titleLG = Font.system(size: 28, weight: .bold, design: .default)
    static let titleMD = Font.system(size: 22, weight: .semibold, design: .default)
    static let titleSM = Font.system(size: 20, weight: .light, design: .default)

    // MARK: - Serif
    static let serifLG = Font.system(size: 32, weight: .bold, design: .serif)
    static let serifMD = Font.system(size: 26, weight: .bold, design: .serif)
    static let serifSM = Font.system(size: 20, weight: .semibold, design: .serif)

    // MARK: - Body
    static let body = Font.system(size: 17, weight: .light, design: .default)
    static let bodyBold = Font.system(size: 17, weight: .bold, design: .default)
    static let bodyLight = Font.system(size: 17, weight: .light, design: .default)
    static let bodySmall = Font.system(size: 15, weight: .regular, design: .default)
    static let bodySmallLight = Font.system(size: 14, weight: .light, design: .default)

    // MARK: - Labels / Captions
    static let caption = Font.system(size: 13, weight: .bold, design: .default)
    static let captionLight = Font.system(size: 13, weight: .light, design: .default)
    static let captionSmall = Font.system(size: 12, weight: .semibold, design: .default)
    static let micro = Font.system(size: 10, weight: .light, design: .default)
    static let tabLabel = Font.system(size: 11, weight: .regular, design: .default)

    // MARK: - Chat
    static let chatBody = Font.system(size: 16, weight: .regular, design: .default)
    static let chatTimestamp = Font.system(size: 12, weight: .regular, design: .default)

    // MARK: - Utility
    static let headline = Font.system(size: 17, weight: .semibold, design: .default)
    static let mono = Font.system(size: 13, weight: .regular, design: .monospaced)
}
