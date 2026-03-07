import SwiftUI

/// Drop-down banner that appears when a recipe URL is detected on the clipboard.
///
/// Detection flow:
/// 1. Checks `UIPasteboard.general.hasURLs` as a lightweight probe.
/// 2. If a URL is present, reads the string and runs it through
///    `RecipeURLDetector` (domain list + path keywords + food vocabulary).
/// 3. Only shows the banner if the URL passes the recipe heuristic.
///
/// Reading the pasteboard string triggers iOS's paste notification banner,
/// which is transparent and expected — we show our banner immediately after.
///
/// Respects the `clipboardDetectionEnabled` UserDefaults toggle
/// (managed in Settings). The banner auto-dismisses on tap of X and
/// re-checks when the app returns to foreground with new clipboard content.
struct ClipboardBanner: View {
    /// Called when the user taps "Import" with the clipboard URL string.
    var onImport: (String) -> Void

    @AppStorage("clipboardDetectionEnabled") private var enabled = true
    @Environment(\.scenePhase) private var scenePhase

    @State private var detectedURL: String?
    @State private var dismissed = false
    /// Tracks the clipboard change count at dismissal so we don't
    /// re-show the banner for the same content.
    @State private var dismissedChangeCount: Int?

    var body: some View {
        if enabled, let url = detectedURL, !dismissed {
            bannerContent(url: url)
                .transition(.move(edge: .top).combined(with: .opacity))
                .padding(.horizontal, AlchemySpacing.lg)
                .padding(.top, AlchemySpacing.sm)
        }
    }

    private func bannerContent(url: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "link")
                .font(.title3.weight(.semibold))
                .foregroundStyle(.tint)

            VStack(alignment: .leading, spacing: 2) {
                Text("Recipe Detected")
                    .font(.subheadline.weight(.semibold))
                Text(displayDomain(from: url))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer()

            Button {
                withAnimation { dismissed = true }
                onImport(url)
            } label: {
                Text("Import")
                    .font(.subheadline.weight(.semibold))
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(.ultraThinMaterial)
                    .clipShape(Capsule())
            }

            Button {
                dismissedChangeCount = UIPasteboard.general.changeCount
                withAnimation { dismissed = true }
            } label: {
                Image(systemName: "xmark")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 28, height: 28)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.15), radius: 8, y: 4)
        .onAppear { checkClipboard() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { checkClipboard() }
        }
    }

    /// Extracts a clean domain name for display (e.g. "allrecipes.com").
    private func displayDomain(from urlString: String) -> String {
        guard let url = URL(string: urlString),
              let host = url.host?.lowercased() else {
            return "On your clipboard"
        }
        return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }

    /// Synchronous clipboard check:
    /// 1. Quick `hasURLs` probe (metadata, no paste prompt on most versions)
    /// 2. Read string and run through RecipeURLDetector heuristic
    private func checkClipboard() {
        guard enabled else { return }

        // Don't re-show for the same clipboard content after dismissal
        if dismissedChangeCount == UIPasteboard.general.changeCount {
            return
        }

        // Quick check: does the pasteboard claim to contain URLs?
        guard UIPasteboard.general.hasURLs else {
            withAnimation { detectedURL = nil }
            return
        }

        // Read the actual string and run recipe heuristic.
        // On iOS 16+ this triggers a small paste notification banner.
        guard let string = UIPasteboard.general.string else {
            withAnimation { detectedURL = nil }
            return
        }

        let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)

        if RecipeURLDetector.isLikelyRecipe(urlString: trimmed) {
            withAnimation(.easeInOut(duration: 0.3)) {
                detectedURL = trimmed
                dismissed = false
            }
        } else {
            withAnimation { detectedURL = nil }
        }
    }
}
