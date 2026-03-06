import SwiftUI

/// User profile icon button that opens a Liquid Glass context menu.
///
/// Placed in the top-right of navigation headers across all main screens.
/// The menu provides navigation to Preferences, Settings, and Admin.
/// Uses iOS 26 `.glassEffect()` on the icon background for the glass pill look.
struct ProfileMenu: View {
    var onPreferences: () -> Void = {}
    var onSettings: () -> Void = {}
    var onAdmin: () -> Void = {}

    var body: some View {
        Menu {
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

            Divider()

            Button {
                onAdmin()
            } label: {
                Label("Admin", systemImage: "lock.shield")
            }
        } label: {
            Image(systemName: "person.circle.fill")
                .font(.title3)
                .foregroundStyle(AlchemyColors.textPrimary)
                .frame(width: AlchemySpacing.minTouchTarget, height: AlchemySpacing.minTouchTarget)
        }
    }
}
