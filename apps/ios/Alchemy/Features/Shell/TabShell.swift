import SwiftUI

/// Root tab container with three main tabs + an import accessory button
/// using iOS 26 native Liquid Glass tab bar.
///
/// The tab bar automatically adopts the Liquid Glass material when compiled
/// against iOS 26 SDK. We enable minimize-on-scroll so content gets maximum
/// vertical space, and the bar collapses into a floating glass pill.
///
/// The Import button uses `Tab(role: .search)` to render as a visually
/// separated floating glass circle (like Apple Music's Search button).
/// Tapping it opens a confirmation dialog with import options instead of
/// navigating to a tab.
///
/// Navigation to Preferences/Settings is handled via ProfileMenu in each
/// tab's navigation header, not via the tab bar itself.
struct TabShell: View {
    /// Deep link URL from the share extension (alchemy://import?kind=...).
    /// Consumed on appear to trigger the import flow.
    @Binding var pendingImportURL: URL?

    @State private var selectedTab: AppTab = .cookbook
    /// Tracks the previously selected tab so we can revert when the
    /// import "tab" is tapped (it opens a dialog, not a tab view).
    @State private var previousTab: AppTab = .cookbook
    @State private var showPreferences = false
    @State private var showSettings = false
    @State private var showImportDialog = false
    @State private var showImportSheet = false
    /// When set, GenerateView picks up this session and jumps to
    /// the .presenting phase with the imported recipe candidate.
    @State private var importedSession: ChatSessionResponse?
    /// Tracks which import method the user selected from the dialog.
    @State private var selectedImportMethod: ImportMethod?

    var body: some View {
        TabView(selection: $selectedTab) {
            Tab("Cookbook", systemImage: "book.fill", value: .cookbook) {
                CookbookView()
            }

            Tab("Sous Chef", systemImage: "sparkles", value: .sousChef) {
                GenerateView(selectedTab: $selectedTab, importedSession: $importedSession)
            }

            Tab("Explore", systemImage: "safari", value: .explore) {
                ExploreView()
            }

            // Import button — visually separated from the main tabs with a gap.
            // Uses .search role for the separated Liquid Glass circle placement.
            // Does not navigate to a tab; instead opens the import dialog.
            Tab("Import", systemImage: "square.and.arrow.down", value: .import, role: .search) {
                Color.clear
            }
        }
        .tabViewStyle(.tabBarOnly)
        .tabBarMinimizeBehavior(.onScrollDown)
        .tint(AlchemyColors.textPrimary)
        .onChange(of: selectedTab) { oldValue, newValue in
            if newValue == .import {
                // Revert to the previous real tab and show the import dialog
                selectedTab = oldValue
                showImportDialog = true
            } else {
                previousTab = newValue
            }
        }
        .confirmationDialog("Import Recipe", isPresented: $showImportDialog) {
            Button {
                selectedImportMethod = .url
                showImportSheet = true
            } label: {
                Label("Paste URL", systemImage: "link")
            }
            Button {
                selectedImportMethod = .photo
                showImportSheet = true
            } label: {
                Label("Take Photo", systemImage: "camera")
            }
            Button {
                selectedImportMethod = .text
                showImportSheet = true
            } label: {
                Label("Paste Text", systemImage: "doc.text")
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Import a recipe from a website, cookbook photo, or text.")
        }
        .sheet(isPresented: $showImportSheet) {
            if let method = selectedImportMethod {
                ImportView(method: method) { session in
                    showImportSheet = false
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
    }
}

/// App-wide tab identifiers.
/// Keeping these in one enum ensures consistency between TabShell and any
/// programmatic tab switching (e.g., post-commit "go to cookbook" action).
enum AppTab: String, Hashable {
    case cookbook
    case sousChef
    case explore
    /// Virtual tab — tapping it opens the import dialog, not a tab view.
    case `import`
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
