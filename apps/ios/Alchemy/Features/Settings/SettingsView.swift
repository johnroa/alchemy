import SwiftUI

/// Settings screen with Liquid Glass design matching the Preferences sheet.
///
/// Sections:
/// - Account: email from Supabase session
/// - Import: clipboard recipe detection toggle
/// - Memory: count from GET /memories, reset via POST /memories/reset
/// - App: version
/// - Legal: privacy policy, terms of use
/// - Sign Out
///
/// Uses `Form` with `.scrollContentBackground(.hidden)` for the iOS 26
/// Liquid Glass translucency, and `.tint(.white)` to match Preferences.
struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss

    @State private var memoryCount = 0
    @State private var isLoadingMemories = true
    @State private var isResettingMemories = false
    @State private var showResetConfirmation = false

    /// Persisted toggle for clipboard recipe detection. Read by
    /// ClipboardBanner in TabShell to decide whether to probe
    /// the clipboard for recipe URLs.
    @AppStorage("clipboardDetectionEnabled") private var clipboardDetectionEnabled = true

    private let authManager = AuthManager.shared

    /// Placeholder URLs — replace with real hosted pages once available.
    private static let privacyPolicyURL = URL(string: "https://cookwithalchemy.com/privacy")!
    private static let termsOfUseURL = URL(string: "https://cookwithalchemy.com/terms")!

    var body: some View {
        NavigationStack {
            Form {
                Section("Account") {
                    HStack {
                        Label("Email", systemImage: "envelope")
                        Spacer()
                        Text(authManager.userEmail ?? "—")
                            .foregroundStyle(.secondary)
                    }
                }

                Section {
                    Toggle(isOn: $clipboardDetectionEnabled) {
                        Label("Detect Recipe URLs", systemImage: "link.badge.plus")
                    }
                } header: {
                    Label("Import", systemImage: "square.and.arrow.down")
                } footer: {
                    Text("When enabled, a banner appears if a recipe URL is detected on your clipboard.")
                }

                Section("Memory") {
                    HStack {
                        Label("Stored Memories", systemImage: "brain.head.profile")
                        Spacer()
                        if isLoadingMemories {
                            ProgressView()
                        } else {
                            Text("\(memoryCount)")
                                .foregroundStyle(.secondary)
                        }
                    }

                    Button(role: .destructive) {
                        showResetConfirmation = true
                    } label: {
                        Label(
                            isResettingMemories ? "Resetting..." : "Reset All Memories",
                            systemImage: "arrow.counterclockwise"
                        )
                    }
                    .disabled(isResettingMemories || memoryCount == 0)
                }

                Section("App") {
                    HStack {
                        Label("Version", systemImage: "info.circle")
                        Spacer()
                        Text(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0")
                            .foregroundStyle(.secondary)
                    }
                }

                Section("Legal") {
                    Link(destination: Self.privacyPolicyURL) {
                        Label("Privacy Policy", systemImage: "hand.raised")
                    }

                    Link(destination: Self.termsOfUseURL) {
                        Label("Terms of Use", systemImage: "doc.text")
                    }
                }

                Section {
                    Button(role: .destructive) {
                        Task {
                            await authManager.signOut()
                            dismiss()
                        }
                    } label: {
                        Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
            .confirmationDialog(
                "Reset All Memories?",
                isPresented: $showResetConfirmation,
                titleVisibility: .visible
            ) {
                Button("Reset", role: .destructive) {
                    Task { await resetMemories() }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This will permanently delete all learned preferences and cooking memories. This cannot be undone.")
            }
            .task { await loadMemories() }
        }
        .tint(.white)
    }

    // MARK: - API

    private func loadMemories() async {
        isLoadingMemories = true
        defer { isLoadingMemories = false }

        do {
            let response: MemoryListResponse = try await APIClient.shared.request("/memories")
            memoryCount = response.items.count
        } catch {
            print("[SettingsView] loadMemories failed: \(error)")
        }
    }

    private func resetMemories() async {
        isResettingMemories = true
        defer { isResettingMemories = false }

        do {
            try await APIClient.shared.requestVoid("/memories/reset", method: .post)
            withAnimation { memoryCount = 0 }
        } catch {
            print("[SettingsView] resetMemories failed: \(error)")
        }
    }
}
