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

    var body: some View {
        HStack {
            HStack(spacing: 0) {
                ForEach(AlchemyTab.allCases, id: \.self) { tab in
                    tabButton(for: tab)
                }
            }
            .padding(.horizontal, 4)
            .padding(.vertical, 4)
            .frame(maxWidth: 306)
            .background(
                Capsule()
                    .fill(Color.white.opacity(0.2))
                    .background(
                        Capsule()
                            .fill(.ultraThinMaterial)
                            .opacity(0.92)
                    )
                    .overlay(
                        Capsule()
                            .stroke(Color.white.opacity(0.18), lineWidth: 0.6)
                    )
            )
            .shadow(color: .black.opacity(0.1), radius: 20, x: 0, y: 2)
        }
        .padding(.horizontal, 24)
        .padding(.top, 16)
        .padding(.bottom, 24)
    }

    @ViewBuilder
    private func tabButton(for tab: AlchemyTab) -> some View {
        let isSelected = selectedTab == tab
        let tabTextColor = Color.black.opacity(0.76)
        let tabIconColor = isSelected ? tabTextColor : Color.black.opacity(0.56)

        Button {
            withAnimation(.spring(response: 0.45, dampingFraction: 0.72, blendDuration: 0.2)) {
                selectedTab = tab
            }
            triggerLiquidPulse()
        } label: {
            ZStack {
                if isSelected {
                    Capsule()
                        .fill(Color.white.opacity(0.58))
                        .overlay(
                            Capsule()
                                .fill(.ultraThinMaterial)
                                .opacity(0.95)
                        )
                        .overlay(
                            Capsule()
                                .fill(
                                    LinearGradient(
                                        colors: [
                                            Color.white.opacity(0.32),
                                            Color.white.opacity(0.12),
                                            Color.white.opacity(0.06)
                                        ],
                                        startPoint: .topLeading,
                                        endPoint: .bottomTrailing
                                    )
                                )
                        )
                        .overlay(
                            Capsule()
                                .fill(
                                    LinearGradient(
                                        colors: [
                                            Color.clear,
                                            Color.white.opacity(0.82),
                                            Color.clear
                                        ],
                                        startPoint: .leading,
                                        endPoint: .trailing
                                    )
                                )
                                .scaleEffect(x: 1.7, y: 1.0)
                                .offset(x: liquidPulse ? 78 : -78)
                                .blur(radius: 10)
                                .opacity(0.42)
                                .mask(Capsule())
                        )
                        .overlay(
                            Capsule()
                                .stroke(Color.white.opacity(0.46), lineWidth: 0.8)
                        )
                        .scaleEffect(liquidPulse ? 1.018 : 1.0)
                        .matchedGeometryEffect(id: "activeTab", in: tabAnimation)
                }

                VStack(spacing: 2) {
                    Image(systemName: tab.icon)
                        .symbolRenderingMode(.monochrome)
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundColor(tabIconColor)

                    Text(verbatim: tab.rawValue)
                        .font(.system(size: 11, weight: .regular))
                        .foregroundColor(tabTextColor)
                        .lineLimit(1)
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 8)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 53)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .sensoryFeedback(.selection, trigger: selectedTab)
        .accessibilityLabel(tab.rawValue)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
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
