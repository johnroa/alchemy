import SwiftUI

enum AlchemyTab: String, CaseIterable {
    case cookbook = "CookBook"
    case generate = "Generate"

    var icon: String {
        switch self {
        case .cookbook: "book.closed.fill"
        case .generate: "sparkles"
        }
    }
}

struct AlchemyTabBar: View {
    @Binding var selectedTab: AlchemyTab
    @Namespace private var tabAnimation

    var body: some View {
        HStack(spacing: 0) {
            ForEach(AlchemyTab.allCases, id: \.self) { tab in
                tabButton(for: tab)
            }
        }
        .padding(.horizontal, Spacing.xs)
        .padding(.vertical, Spacing.xs)
        .frame(height: 56)
        .background(
            Capsule()
                .fill(AlchemyColors.tabGlass)
                .overlay(
                    Capsule()
                        .stroke(Color.white.opacity(0.16), lineWidth: 0.5)
                )
        )
        .shadow(color: .black.opacity(0.2), radius: 20, x: 0, y: 2)
        .padding(.horizontal, Spacing.xl + 4)
        .padding(.bottom, Spacing.sm)
    }

    @ViewBuilder
    private func tabButton(for tab: AlchemyTab) -> some View {
        let isSelected = selectedTab == tab

        Button {
            withAnimation(.spring(response: 0.35, dampingFraction: 0.75)) {
                selectedTab = tab
            }
        } label: {
            VStack(spacing: 3) {
                ZStack {
                    if isSelected {
                        Capsule()
                            .fill(AlchemyColors.grey4)
                            .frame(height: 40)
                            .matchedGeometryEffect(id: "activeTab", in: tabAnimation)
                    }

                    Image(systemName: tab.icon)
                        .font(.system(size: 18, weight: isSelected ? .semibold : .regular))
                        .foregroundStyle(isSelected ? AlchemyColors.dark : AlchemyColors.dark.opacity(0.5))
                }
                .frame(height: 40)

                Text(tab.rawValue)
                    .font(AlchemyFont.tabLabel)
                    .foregroundStyle(isSelected ? AlchemyColors.dark : AlchemyColors.dark.opacity(0.8))
            }
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .sensoryFeedback(.selection, trigger: selectedTab)
        .accessibilityLabel(tab.rawValue)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

#if DEBUG
#Preview("Tab Bar") {
    @Previewable @State var tab: AlchemyTab = .cookbook

    VStack {
        Spacer()
        AlchemyTabBar(selectedTab: $tab)
    }
    .background(AlchemyColors.deepDark)
    .preferredColorScheme(.dark)
}
#endif
