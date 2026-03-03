import SwiftUI

struct AlchemyFilterChip: View {
    let title: String
    var emoji: String?
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: {
            Haptics.fire(.selection)
            action()
        }) {
            HStack(spacing: Spacing.xs) {
                if let emoji {
                    Text(emoji)
                        .font(.system(size: 14))
                }
                Text(title)
                    .font(AlchemyFont.caption)
                    .lineLimit(1)
            }
            .padding(.horizontal, Spacing.sm2)
            .padding(.vertical, Spacing.xs)
            .background(isSelected ? AlchemyColors.grey4 : AlchemyColors.dark)
            .foregroundStyle(isSelected ? AlchemyColors.dark : AlchemyColors.grey1)
            .clipShape(Capsule())
            .overlay(
                Capsule()
                    .stroke(
                        isSelected ? Color.clear : Color.clear,
                        lineWidth: 0
                    )
            )
        }
        .buttonStyle(.plain)
    }
}

struct AlchemyFilterRow: View {
    let filters: [String]
    @Binding var selected: String?
    var includeAll: Bool = true

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Spacing.sm) {
                if includeAll {
                    AlchemyFilterChip(
                        title: "All",
                        isSelected: selected == nil
                    ) {
                        selected = nil
                    }
                }

                ForEach(filters, id: \.self) { filter in
                    AlchemyFilterChip(
                        title: filter,
                        isSelected: selected == filter
                    ) {
                        selected = selected == filter ? nil : filter
                    }
                }
            }
            .padding(.horizontal, Spacing.lg)
        }
    }
}

#if DEBUG
#Preview("Filter Chips") {
    @Previewable @State var selection: String?

    AlchemyFilterRow(
        filters: ["Asian", "Italian", "Comfort", "Mexican"],
        selected: $selection
    )
    .background(AlchemyColors.deepDark)
    .preferredColorScheme(.dark)
}
#endif
