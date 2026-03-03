import SwiftUI

@Observable
final class SettingsViewModel {
    var memoryCount = 0
    var snapshotKeys: [String] = []
    var changelogItems: [ChangelogItem] = []
    var isLoading = false
    var error: String?
    var isResetting = false
    var showResetConfirmation = false

    func load(api: APIClient) async {
        isLoading = true
        error = nil

        do {
            let memories = try await api.getMemories()
            let changelog = try await api.getChangelog()

            memoryCount = memories.items.count
            snapshotKeys = memories.snapshot?.keys.sorted() ?? []
            changelogItems = Array(changelog.items.prefix(12))
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }

    func resetMemories(api: APIClient) async {
        isResetting = true

        do {
            _ = try await api.resetMemories()
            memoryCount = 0
            snapshotKeys = []
            Haptics.fire(.success)
        } catch {
            self.error = error.localizedDescription
        }

        isResetting = false
    }
}
