import SwiftUI

/// Root tab container with three tabs using iOS 26 native Liquid Glass tab bar.
///
/// The tab bar automatically adopts the Liquid Glass material when compiled
/// against iOS 26 SDK. We enable minimize-on-scroll so content gets maximum
/// vertical space, and the bar collapses into a floating glass pill.
///
/// Navigation to Preferences/Settings is handled via ProfileMenu in each tab's
/// navigation header, not via the tab bar itself.
struct TabShell: View {
    @State private var selectedTab: AppTab = .cookbook
    @State private var showPreferences = false
    @State private var showSettings = false

    var body: some View {
        TabView(selection: $selectedTab) {
            Tab("Cookbook", systemImage: "book.fill", value: .cookbook) {
                CookbookView()
            }

            Tab("Generate", systemImage: "wand.and.stars", value: .generate) {
                GenerateView()
            }

            Tab("Explore", systemImage: "safari", value: .explore) {
                ExploreView()
            }
        }
        .tabViewStyle(.tabBarOnly)
        .tabBarMinimizeBehavior(.onScrollDown)
        .sheet(isPresented: $showPreferences) {
            PreferencesView()
        }
        .sheet(isPresented: $showSettings) {
            SettingsView()
        }
    }
}

/// App-wide tab identifiers.
/// Keeping these in one enum ensures consistency between TabShell and any
/// programmatic tab switching (e.g., post-commit "go to cookbook" action).
enum AppTab: String, Hashable {
    case cookbook
    case generate
    case explore
}
