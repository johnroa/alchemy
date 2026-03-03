import SwiftUI

struct SettingsView: View {
    @Environment(APIClient.self) private var api
    @Environment(AuthManager.self) private var auth
    @Environment(\.dismiss) private var dismiss
    @State private var vm = SettingsViewModel()

    var body: some View {
        NavigationStack {
            ZStack {
                AlchemyColors.deepDark.ignoresSafeArea()

                if vm.isLoading {
                    ProgressView()
                        .tint(AlchemyColors.grey2)
                } else {
                    settingsContent
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Close") { dismiss() }
                        .foregroundStyle(AlchemyColors.grey2)
                }
            }
            .task {
                await vm.load(api: api)
            }
            .confirmationDialog(
                "Reset Memory",
                isPresented: $vm.showResetConfirmation,
                titleVisibility: .visible
            ) {
                Button("Reset All Memories", role: .destructive) {
                    Task { await vm.resetMemories(api: api) }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This will permanently delete all of Alchemy's learned preferences about you. This cannot be undone.")
            }
        }
    }

    private var settingsContent: some View {
        ScrollView {
            VStack(spacing: Spacing.lg) {
                // Memory section
                memorySection

                // Changelog section
                if !vm.changelogItems.isEmpty {
                    changelogSection
                }

                // Account section
                accountSection

                if let error = vm.error {
                    Text(error)
                        .font(AlchemyFont.captionLight)
                        .foregroundStyle(AlchemyColors.danger)
                }
            }
            .padding(Spacing.md)
        }
    }

    // MARK: - Memory Section

    private var memorySection: some View {
        VStack(alignment: .leading, spacing: Spacing.sm2) {
            Text("Memory")
                .font(AlchemyFont.titleSM)
                .foregroundStyle(AlchemyColors.textPrimary)

            VStack(spacing: Spacing.md) {
                HStack {
                    Text("Active memories")
                        .font(AlchemyFont.body)
                        .foregroundStyle(AlchemyColors.textSecondary)
                    Spacer()
                    Text("\(vm.memoryCount)")
                        .font(AlchemyFont.bodyBold)
                        .foregroundStyle(AlchemyColors.textPrimary)
                }

                if !vm.snapshotKeys.isEmpty {
                    HStack {
                        Text("Snapshot keys")
                            .font(AlchemyFont.body)
                            .foregroundStyle(AlchemyColors.textSecondary)
                        Spacer()
                        Text("\(vm.snapshotKeys.count)")
                            .font(AlchemyFont.bodyBold)
                            .foregroundStyle(AlchemyColors.textPrimary)
                    }
                }

                AlchemyButton(title: "Reset Memory", icon: "trash", variant: .danger, isLoading: vm.isResetting) {
                    vm.showResetConfirmation = true
                }
            }
            .padding(Spacing.md)
            .background(AlchemyColors.card)
            .clipShape(RoundedRectangle(cornerRadius: Radius.lg))
        }
    }

    // MARK: - Changelog Section

    private var changelogSection: some View {
        VStack(alignment: .leading, spacing: Spacing.sm2) {
            Text("Recent Activity")
                .font(AlchemyFont.titleSM)
                .foregroundStyle(AlchemyColors.textPrimary)

            VStack(spacing: 0) {
                ForEach(vm.changelogItems) { item in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(item.scope).\(item.action)")
                                .font(AlchemyFont.captionSmall)
                                .foregroundStyle(AlchemyColors.textPrimary)
                            Text(item.createdAt.prefix(16).replacingOccurrences(of: "T", with: " "))
                                .font(AlchemyFont.micro)
                                .foregroundStyle(AlchemyColors.textTertiary)
                        }
                        Spacer()
                    }
                    .padding(.vertical, Spacing.sm)
                    .padding(.horizontal, Spacing.md)

                    if item.id != vm.changelogItems.last?.id {
                        Divider()
                            .overlay(Color.white.opacity(0.06))
                            .padding(.horizontal, Spacing.md)
                    }
                }
            }
            .background(AlchemyColors.card)
            .clipShape(RoundedRectangle(cornerRadius: Radius.lg))
        }
    }

    // MARK: - Account Section

    private var accountSection: some View {
        VStack(alignment: .leading, spacing: Spacing.sm2) {
            Text("Account")
                .font(AlchemyFont.titleSM)
                .foregroundStyle(AlchemyColors.textPrimary)

            VStack(spacing: Spacing.md) {
                if let email = auth.userEmail {
                    HStack {
                        Text("Email")
                            .font(AlchemyFont.body)
                            .foregroundStyle(AlchemyColors.textSecondary)
                        Spacer()
                        Text(email)
                            .font(AlchemyFont.bodySmall)
                            .foregroundStyle(AlchemyColors.textPrimary)
                    }
                }

                AlchemyButton(title: "Sign Out", icon: "rectangle.portrait.and.arrow.right", variant: .ghost) {
                    Task {
                        await auth.signOut()
                        dismiss()
                    }
                }
            }
            .padding(Spacing.md)
            .background(AlchemyColors.card)
            .clipShape(RoundedRectangle(cornerRadius: Radius.lg))
        }
    }
}
