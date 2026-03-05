import SwiftUI

struct AlchemyTopNav: View {
    var title: String?
    var horizontalPadding: CGFloat = Spacing.md
    var topPadding: CGFloat = 20
    var trailingIcon: String = "person.crop.circle.fill"
    var trailingAction: (() -> Void)?

    var body: some View {
        VStack(spacing: Spacing.sm2) {
            HStack {
                Spacer()
                if let trailingAction {
                    Button(action: trailingAction) {
                        Image(systemName: trailingIcon)
                            .font(.system(size: 22, weight: .semibold))
                            .foregroundStyle(AlchemyColors.grey2)
                            .frame(width: 36, height: 36)
                            .background(
                                Circle().fill(Color.white.opacity(0.6))
                            )
                    }
                    .buttonStyle(.plain)
                } else {
                    Circle()
                        .fill(Color.clear)
                        .frame(width: 36, height: 36)
                }
            }

            if let title, !title.isEmpty {
                Text(title)
                    .font(AlchemyFont.largeTitle)
                    .foregroundStyle(AlchemyColors.textPrimary)
                    .tracking(0.4)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(.horizontal, horizontalPadding)
        .padding(.top, topPadding)
    }
}

struct HeaderProfileButton: View {
    var isInteractive: Bool = true
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Image("chef-hat")
                .renderingMode(.template)
                .resizable()
                .scaledToFit()
                .frame(width: 22, height: 22)
                .foregroundStyle(AlchemyColors.deepDark)
                .frame(width: 36, height: 36)
                .background(
                    Circle().fill(Color.white.opacity(0.6))
                )
        }
        .buttonStyle(.plain)
        .allowsHitTesting(isInteractive)
    }
}

struct AlchemyScreenHeader: View {
    let title: String
    var onProfileTap: () -> Void
    var isProfileInteractive: Bool = true
    var leading: AnyView?

    var body: some View {
        HStack(alignment: .center, spacing: Spacing.md) {
            if let leading {
                leading
            }

            Text(title)
                .font(AlchemyFont.largeTitle)
                .foregroundStyle(AlchemyColors.textPrimary)
                .tracking(0.4)
                .lineLimit(1)
                .minimumScaleFactor(0.72)

            Spacer(minLength: Spacing.md)

            HeaderProfileButton(
                isInteractive: isProfileInteractive,
                action: onProfileTap
            )
        }
        .frame(height: Sizing.headerRowHeight)
        .padding(.horizontal, Spacing.md)
        .padding(.top, Sizing.headerTopInset)
        .padding(.bottom, Spacing.sm2)
    }
}

#if DEBUG
#Preview("Top Nav") {
    ZStack {
        AlchemyColors.deepDark.ignoresSafeArea()
        VStack {
            AlchemyTopNav(title: "Cookbook")
            Spacer()
        }
    }
    .preferredColorScheme(.dark)
}
#endif
