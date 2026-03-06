import SwiftUI

/// Stub settings screen with grouped sections.
///
/// When wired to the API, account actions will call Supabase auth methods
/// and memory endpoints (GET /memories, POST /memories/reset).
struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section("Account") {
                    HStack {
                        Label("Email", systemImage: "envelope")
                        Spacer()
                        Text("user@example.com")
                            .foregroundStyle(AlchemyColors.textSecondary)
                    }

                    NavigationLink {
                        Text("Change Password")
                            .foregroundStyle(AlchemyColors.textPrimary)
                    } label: {
                        Label("Password", systemImage: "lock")
                    }
                }

                Section("Memory") {
                    HStack {
                        Label("Stored Memories", systemImage: "brain.head.profile")
                        Spacer()
                        Text("12")
                            .foregroundStyle(AlchemyColors.textSecondary)
                    }

                    Button(role: .destructive) {
                        // Will call POST /memories/reset
                    } label: {
                        Label("Reset All Memories", systemImage: "arrow.counterclockwise")
                    }
                }

                Section("App") {
                    HStack {
                        Label("Version", systemImage: "info.circle")
                        Spacer()
                        Text("1.0.0")
                            .foregroundStyle(AlchemyColors.textSecondary)
                    }

                    NavigationLink {
                        Text("Changelog")
                            .foregroundStyle(AlchemyColors.textPrimary)
                    } label: {
                        Label("What's New", systemImage: "sparkles")
                    }
                }

                Section {
                    Button(role: .destructive) {
                        // Will call supabase.auth.signOut()
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
        }
    }
}
