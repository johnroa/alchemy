import SwiftUI

struct TabShell: View {
    @State private var selectedTab: AlchemyTab = .generate
    @State private var showPreferences = false
    @State private var showSettings = false

    var body: some View {
        ZStack(alignment: .bottom) {
            // Tab content
            Group {
                switch selectedTab {
                case .cookbook:
                    CookbookView(
                        showPreferences: $showPreferences,
                        showSettings: $showSettings
                    )
                case .generate:
                    GenerateView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .animation(.easeInOut(duration: 0.2), value: selectedTab)

            // Floating tab bar
            AlchemyTabBar(selectedTab: $selectedTab)
        }
        .background(AlchemyColors.deepDark)
        .sheet(isPresented: $showPreferences) {
            PreferencesView()
        }
        .sheet(isPresented: $showSettings) {
            SettingsView()
        }
    }
}
