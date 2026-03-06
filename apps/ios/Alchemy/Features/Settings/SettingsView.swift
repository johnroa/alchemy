import SwiftUI

/// Settings screen wired to real API endpoints.
///
/// Sections:
/// - Account: email from Supabase session
/// - Memory: count from GET /memories, reset via POST /memories/reset
/// - App: version, changelog
/// - Sign Out: calls AuthManager.signOut()
struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss

    @State private var memoryCount = 0
    @State private var isLoadingMemories = true
    @State private var isResettingMemories = false
    @State private var showResetConfirmation = false

    private let authManager = AuthManager.shared

    var body: some View {
        NavigationStack {
            List {
                Section("Account") {
                    HStack {
                        Label("Email", systemImage: "envelope")
                        Spacer()
                        Text(authManager.userEmail ?? "—")
                            .foregroundStyle(AlchemyColors.textSecondary)
                    }
                }

                Section("Memory") {
                    HStack {
                        Label("Stored Memories", systemImage: "brain.head.profile")
                        Spacer()
                        if isLoadingMemories {
                            ProgressView()
                        } else {
                            Text("\(memoryCount)")
                                .foregroundStyle(AlchemyColors.textSecondary)
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
                            .foregroundStyle(AlchemyColors.textSecondary)
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
