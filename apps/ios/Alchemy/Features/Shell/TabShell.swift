import SwiftUI

/// Root tab container with three main tabs using iOS 26 native Liquid Glass
/// tab bar.
///
/// The tab bar automatically adopts the Liquid Glass material when compiled
/// against iOS 26 SDK. We enable minimize-on-scroll so content gets maximum
/// vertical space, and the bar collapses into a floating glass pill.
///
/// Import is triggered via ImportMenu (plus button) in each tab's navigation
/// header — not from the tab bar. TabShell owns the import sheet and injects
/// an ImportAction into the environment so any child can trigger it.
///
/// Navigation to Preferences/Settings is handled via ProfileMenu in each
/// tab's navigation header, not via the tab bar itself.
struct TabShell: View {
    /// Deep link URL from the share extension (alchemy://import?kind=...).
    /// Consumed on appear to trigger the import flow.
    @Binding var pendingImportURL: URL?

    @State private var selectedTab: AppTab = .cookbook
    @State private var showPreferences = false
    @State private var showSettings = false
    @State private var showImportSheet = false
    /// When set, GenerateView picks up this session and jumps to
    /// the .presenting phase with the imported recipe candidate.
    @State private var importedSession: ChatSessionResponse?
    /// Tracks which import method the user selected from ImportMenu.
    @State private var selectedImportMethod: ImportMethod?
    /// URL pre-filled by the clipboard banner. Passed to ImportView
    /// so the URL text field is populated when the sheet opens.
    @State private var prefillURL: String?
    /// When non-nil, a recipe is being saved in the background.
    /// CookbookView shows a skeleton card; GenerateView resets.
    /// Cleared when the commit API finishes (success or failure).
    @State private var pendingSave: PendingSave?

    var body: some View {
        TabView(selection: $selectedTab) {
            Tab("Cookbook", systemImage: "book.fill", value: .cookbook) {
                CookbookView(pendingSave: $pendingSave)
            }

            Tab("Sous Chef", systemImage: "sparkles", value: .sousChef) {
                GenerateView(selectedTab: $selectedTab, importedSession: $importedSession, pendingSave: $pendingSave)
            }

            Tab("Explore", systemImage: "safari", value: .explore) {
                ExploreView()
            }
        }
        .tabViewStyle(.tabBarOnly)
        .tabBarMinimizeBehavior(.onScrollDown)
        .tint(AlchemyColors.textPrimary)
        .environment(\.importAction, ImportAction { method in
            selectedImportMethod = method
            showImportSheet = true
        })
        .overlay(alignment: .top) {
            ClipboardBanner { url in
                prefillURL = url
                selectedImportMethod = .url
                showImportSheet = true
            }
        }
        .sheet(isPresented: $showImportSheet) {
            if let method = selectedImportMethod {
                ImportView(method: method, prefillURL: prefillURL) { session in
                    showImportSheet = false
                    prefillURL = nil
                    importedSession = session
                    selectedTab = .sousChef
                }
            }
        }
        .onChange(of: pendingImportURL) { _, url in
            guard let url else { return }
            handleShareExtensionImport(url: url)
            pendingImportURL = nil
        }
        .sheet(isPresented: $showPreferences) {
            PreferencesView(selectedTab: $selectedTab)
        }
        .sheet(isPresented: $showSettings) {
            SettingsView()
        }
        .task {
            ExploreFeedPreloader.shared.preload()
        }
    }
}

/// App-wide tab identifiers.
/// Keeping these in one enum ensures consistency between TabShell and any
/// programmatic tab switching (e.g., post-commit "go to cookbook" action).
enum AppTab: String, Hashable {
    case cookbook
    case sousChef
    case explore
}

extension TabShell {
    /// Reads the pending import payload from the App Group container
    /// and opens the appropriate import sheet.
    func handleShareExtensionImport(url: URL) {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let kindParam = components.queryItems?.first(where: { $0.name == "kind" })?.value else {
            return
        }

        switch kindParam {
        case "url":
            selectedImportMethod = .url
        case "text":
            selectedImportMethod = .text
        case "photo":
            selectedImportMethod = .photo
        default:
            return
        }

        showImportSheet = true
    }
}

/// Import method selected from the import dialog.
enum ImportMethod {
    case url
    case photo
    case text
}

/// Lightweight snapshot of a recipe being committed in the background.
/// CookbookView uses this to render a skeleton card while the API runs.
struct PendingSave: Equatable {
    let title: String
    let imageUrl: String?
}
