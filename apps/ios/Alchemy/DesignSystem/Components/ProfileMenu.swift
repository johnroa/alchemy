import SwiftUI

/// User profile icon button that opens a Liquid Glass context menu.
///
/// Placed in the top-right of navigation headers across all main screens.
/// The menu provides navigation to Preferences, Settings, sharing, and Admin.
struct ProfileMenu: View {
    var onPreferences: () -> Void = {}
    var onSettings: () -> Void = {}
    var onAdmin: () -> Void = {}

    /// Controls the iOS share sheet presented via `.sheet`.
    @State private var showShareSheet = false

    /// Placeholder App Store URL. Replace with the real link once
    /// the app is listed. The share sheet sends this text.
    private static let shareURL = URL(string: "https://apps.apple.com/app/alchemy-recipes/id0000000000")!
    private static let shareText = "Check out Alchemy — an AI-powered recipe app that personalizes every dish to your kitchen."

    var body: some View {
        Menu {
            Section("Main Menu") {
                Button {
                    onPreferences()
                } label: {
                    Label("Preferences", systemImage: "slider.horizontal.3")
                }

                Button {
                    onSettings()
                } label: {
                    Label("Settings", systemImage: "gearshape")
                }

                Button {
                    showShareSheet = true
                } label: {
                    Label("Tell a Friend", systemImage: "square.and.arrow.up")
                }
            }

            Divider()

            Button {
                onAdmin()
            } label: {
                Label("Admin", systemImage: "lock.shield")
            }
        } label: {
            Image("chef-hat")
                .renderingMode(.template)
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: 28, height: 28)
                .foregroundStyle(AlchemyColors.textPrimary)
                .frame(width: AlchemySpacing.minTouchTarget, height: AlchemySpacing.minTouchTarget)
        }
        .sheet(isPresented: $showShareSheet) {
            ShareSheet(items: [Self.shareText, Self.shareURL])
                .presentationDetents([.medium, .large])
        }
    }
}

// MARK: - Share Sheet

/// Thin UIKit wrapper for UIActivityViewController.
/// SwiftUI has no native share sheet API as of iOS 26, so this
/// UIViewControllerRepresentable bridges the gap.
struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
