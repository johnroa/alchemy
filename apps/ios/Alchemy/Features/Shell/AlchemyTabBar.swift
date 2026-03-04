import SwiftUI

enum AlchemyTab: String, CaseIterable {
    case cookbook = "Cookbook"
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
    @State private var liquidPulse = false
    private let compactWidth: CGFloat = 332 * 0.8

    var body: some View {
        HStack {
            HStack(spacing: 0) {
                ForEach(AlchemyTab.allCases, id: \.self) { tab in
                    tabButton(for: tab)
                }
            }
            .padding(.horizontal, 9)
            .padding(.vertical, 9)
            .frame(width: compactWidth)
            .background(tabBarGlassBackground)
        }
        .padding(.horizontal, 20)
        .padding(.top, 18)
        .padding(.bottom, 18)
    }

    @ViewBuilder
    private func tabButton(for tab: AlchemyTab) -> some View {
        let isSelected = selectedTab == tab
        let tabTextColor = Color.white.opacity(isSelected ? 0.82 : 0.58)
        let tabIconColor = Color.white.opacity(isSelected ? 0.86 : 0.62)

        Button {
            withAnimation(.spring(response: 0.45, dampingFraction: 0.72, blendDuration: 0.2)) {
                selectedTab = tab
            }
            triggerLiquidPulse()
        } label: {
            ZStack {
                if isSelected {
                    selectedTabGlass
                        .padding(.horizontal, 2)
                        .padding(.vertical, 2)
                        .scaleEffect(liquidPulse ? 1.02 : 1.0)
                        .matchedGeometryEffect(id: "activeTab", in: tabAnimation)
                }

                VStack(spacing: 4) {
                    Image(systemName: tab.icon)
                        .symbolRenderingMode(.monochrome)
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundColor(tabIconColor)

                    Text(verbatim: tab.rawValue)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(tabTextColor)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
                .padding(.horizontal, 6)
                .padding(.vertical, 6)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 58)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .sensoryFeedback(.selection, trigger: selectedTab)
        .accessibilityLabel(tab.rawValue)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var tabBarGlassBackground: some View {
        ZStack {
            if #available(iOS 26.0, *) {
                Capsule()
                    .fill(Color.clear)
                    .glassEffect(
                        .regular.tint(Color.white.opacity(0.03)),
                        in: Capsule()
                    )
            } else {
                Capsule()
                    .fill(.ultraThinMaterial)
                    .opacity(0.48)
                    .overlay(
                        Capsule()
                            .fill(
                                LinearGradient(
                                    colors: [
                                        Color.white.opacity(0.06),
                                        Color.white.opacity(0.02),
                                        Color.clear
                                    ],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                            )
                    )
            }

            Capsule()
                .fill(
                    LinearGradient(
                        colors: [
                            Color.white.opacity(0.09),
                            Color.white.opacity(0.03),
                            Color.clear
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )

            Capsule()
                .stroke(Color.white.opacity(0.14), lineWidth: 0.72)

            Capsule()
                .stroke(Color.white.opacity(0.06), lineWidth: 1.2)
                .blur(radius: 4)
                .opacity(0.26)
        }
        .shadow(color: .black.opacity(0.1), radius: 10, x: 0, y: 5)
        .shadow(color: .white.opacity(0.03), radius: 2, x: 0, y: -1)
    }

    private var selectedTabGlass: some View {
        ZStack {
            if #available(iOS 26.0, *) {
                Capsule()
                    .fill(Color.clear)
                    .glassEffect(
                        .regular.tint(Color.white.opacity(0.04)),
                        in: Capsule()
                    )
            } else {
                Capsule()
                    .fill(.ultraThinMaterial)
                    .opacity(0.58)
                    .overlay(
                        Capsule()
                            .fill(
                                LinearGradient(
                                    colors: [
                                        Color.white.opacity(0.1),
                                        Color.white.opacity(0.02),
                                        Color.clear
                                    ],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                            )
                    )
            }

            Capsule()
                .fill(
                    LinearGradient(
                        colors: [
                            Color.white.opacity(0.14),
                            Color.white.opacity(0.05),
                            Color.clear
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )

            Capsule()
                .fill(
                    LinearGradient(
                        colors: [
                            Color.clear,
                            Color.white.opacity(0.4),
                            Color.clear
                        ],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                )
                .scaleEffect(x: 1.65, y: 1)
                .offset(x: liquidPulse ? 82 : -82)
                .blur(radius: 9)
                .opacity(0.14)
                .mask(Capsule())

            Capsule()
                .stroke(Color.white.opacity(0.24), lineWidth: 0.8)

            Capsule()
                .stroke(Color.black.opacity(0.1), lineWidth: 0.6)
                .padding(1.2)
        }
        .shadow(color: .black.opacity(0.1), radius: 8, x: 0, y: 4)
        .shadow(color: .white.opacity(0.05), radius: 2, x: 0, y: -1)
    }

    private func triggerLiquidPulse() {
        liquidPulse = false
        withAnimation(.easeOut(duration: 0.2)) {
            liquidPulse = true
        }
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(360))
            withAnimation(.easeInOut(duration: 0.26)) {
                liquidPulse = false
            }
        }
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
