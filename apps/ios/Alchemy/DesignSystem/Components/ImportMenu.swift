import SwiftUI

/// Callback type injected by TabShell to trigger the import flow.
/// When a child view calls this with an ImportMethod, TabShell presents
/// the corresponding ImportView sheet.
///
/// The trigger closure is `@MainActor` because it mutates @State properties
/// in TabShell. `@unchecked Sendable` is safe here because the trigger
/// is only ever called from SwiftUI button actions (main actor) and the
/// closure itself is main-actor-isolated.
struct ImportAction: @unchecked Sendable {
    var trigger: @MainActor (ImportMethod) -> Void

    @MainActor
    func callAsFunction(_ method: ImportMethod) {
        trigger(method)
    }
}

private struct ImportActionKey: EnvironmentKey {
    static let defaultValue = ImportAction { _ in }
}

extension EnvironmentValues {
    /// Import trigger injected by TabShell. Child views read this
    /// through ImportMenu without needing direct bindings.
    var importAction: ImportAction {
        get { self[ImportActionKey.self] }
        set { self[ImportActionKey.self] = newValue }
    }
}

/// Plus-button menu for importing recipes from URL, photo, or text.
///
/// Mirrors the ProfileMenu pattern: a tappable icon that reveals a
/// dropdown menu on press. Reads the import trigger from the environment
/// so it can be placed in any screen without plumbing callbacks.
struct ImportMenu: View {
    @Environment(\.importAction) private var importAction

    var body: some View {
        Menu {
            Section("Import Recipe") {
                Button {
                    importAction(.url)
                } label: {
                    Label("Paste URL", systemImage: "link")
                }

                Button {
                    importAction(.photo)
                } label: {
                    Label("Scan Photo", systemImage: "camera")
                }

                Button {
                    importAction(.text)
                } label: {
                    Label("Paste Text", systemImage: "doc.text")
                }
            }
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(AlchemyColors.textPrimary)
                .frame(
                    width: AlchemySpacing.minTouchTarget,
                    height: AlchemySpacing.minTouchTarget
                )
        }
    }
}
