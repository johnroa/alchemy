import UIKit
import UniformTypeIdentifiers

/// iOS Share Extension for importing recipes from Safari, other apps, etc.
///
/// The extension NEVER talks to the API directly — it extracts the shared
/// content (URL, text, or image), writes it to the App Group container,
/// then opens the main app via the `alchemy://import` URL scheme.
/// The main app reads from the App Group, performs auth + upload + API call.
///
/// This keeps the extension lightweight (no auth, no networking) and avoids
/// the 30s execution limit being a problem for LLM-backed processing.
class ShareViewController: UIViewController {

    /// App Group identifier shared between the main app and this extension.
    /// Must match the group configured in both targets' entitlements.
    private let appGroupId = "group.com.cookwithalchemy.shared"

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        handleSharedContent()
    }

    private func handleSharedContent() {
        guard let items = extensionContext?.inputItems as? [NSExtensionItem] else {
            close()
            return
        }

        for item in items {
            guard let attachments = item.attachments else { continue }

            for provider in attachments {
                // URL (from Safari share, etc.)
                if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                    provider.loadItem(forTypeIdentifier: UTType.url.identifier) { [weak self] data, _ in
                        if let url = data as? URL {
                            self?.handoff(kind: "url", value: url.absoluteString)
                        } else if let urlData = data as? Data, let url = URL(dataRepresentation: urlData, relativeTo: nil) {
                            self?.handoff(kind: "url", value: url.absoluteString)
                        }
                    }
                    return
                }

                // Plain text
                if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                    provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) { [weak self] data, _ in
                        if let text = data as? String {
                            self?.handoff(kind: "text", value: text)
                        }
                    }
                    return
                }

                // Image (cookbook photo)
                if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
                    provider.loadItem(forTypeIdentifier: UTType.image.identifier) { [weak self] data, _ in
                        if let url = data as? URL {
                            self?.handoffImage(url: url)
                        } else if let image = data as? UIImage,
                                  let jpegData = image.jpegData(compressionQuality: 0.85) {
                            self?.handoffImageData(jpegData)
                        }
                    }
                    return
                }
            }
        }

        close()
    }

    /// Writes the shared content to the App Group container and opens
    /// the main app with `alchemy://import?kind=<kind>`.
    private func handoff(kind: String, value: String) {
        guard let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: appGroupId
        ) else {
            close()
            return
        }

        let payload: [String: String] = [
            "kind": kind,
            "value": value,
            "origin": "share_extension",
            "timestamp": ISO8601DateFormatter().string(from: Date()),
        ]

        let payloadURL = container.appendingPathComponent("pending_import.json")
        if let data = try? JSONSerialization.data(withJSONObject: payload) {
            try? data.write(to: payloadURL, options: .atomic)
        }

        openMainApp(kind: kind)
    }

    /// Handles image handoff — copies the image file to the App Group container.
    private func handoffImage(url: URL) {
        guard let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: appGroupId
        ) else {
            close()
            return
        }

        let destURL = container.appendingPathComponent("pending_import_image.jpg")
        try? FileManager.default.removeItem(at: destURL)

        if let imageData = try? Data(contentsOf: url),
           let image = UIImage(data: imageData),
           let jpegData = image.jpegData(compressionQuality: 0.85) {
            try? jpegData.write(to: destURL, options: .atomic)
        } else {
            try? FileManager.default.copyItem(at: url, to: destURL)
        }

        let payload: [String: String] = [
            "kind": "photo",
            "value": destURL.lastPathComponent,
            "origin": "share_extension",
            "timestamp": ISO8601DateFormatter().string(from: Date()),
        ]

        let payloadURL = container.appendingPathComponent("pending_import.json")
        if let data = try? JSONSerialization.data(withJSONObject: payload) {
            try? data.write(to: payloadURL, options: .atomic)
        }

        openMainApp(kind: "photo")
    }

    /// Handles raw image data handoff.
    private func handoffImageData(_ jpegData: Data) {
        guard let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: appGroupId
        ) else {
            close()
            return
        }

        let destURL = container.appendingPathComponent("pending_import_image.jpg")
        try? FileManager.default.removeItem(at: destURL)
        try? jpegData.write(to: destURL, options: .atomic)

        let payload: [String: String] = [
            "kind": "photo",
            "value": destURL.lastPathComponent,
            "origin": "share_extension",
            "timestamp": ISO8601DateFormatter().string(from: Date()),
        ]

        let payloadURL = container.appendingPathComponent("pending_import.json")
        if let data = try? JSONSerialization.data(withJSONObject: payload) {
            try? data.write(to: payloadURL, options: .atomic)
        }

        openMainApp(kind: "photo")
    }

    /// Opens the main app via the custom URL scheme.
    private func openMainApp(kind: String) {
        guard let url = URL(string: "alchemy://import?kind=\(kind)") else {
            close()
            return
        }

        // Share extensions can open URLs via UIApplication's open method
        // accessed through the responder chain.
        var responder: UIResponder? = self
        while let r = responder {
            if let application = r as? UIApplication {
                application.open(url, options: [:]) { [weak self] _ in
                    self?.close()
                }
                return
            }
            responder = r.next
        }

        // Fallback: just close the extension
        close()
    }

    private func close() {
        DispatchQueue.main.async { [weak self] in
            self?.extensionContext?.completeRequest(returningItems: nil)
        }
    }
}
