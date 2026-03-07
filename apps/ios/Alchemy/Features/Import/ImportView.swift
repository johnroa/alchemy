import PhotosUI
import SwiftUI

/// Modal sheet for importing recipes from URLs, photos, or pasted text.
///
/// Presented by TabShell after the user taps the import menu action.
/// On successful import, calls `onImported` with the seeded ChatSession,
/// which TabShell uses to navigate to GenerateView with the imported recipe.
struct ImportView: View {
    let method: ImportMethod
    /// Optional URL pre-filled by the clipboard banner. When set,
    /// the URL text field is populated on appear and the import
    /// starts automatically.
    var prefillURL: String? = nil
    /// Called on the main actor when the import API succeeds. The caller
    /// (TabShell) uses this to dismiss the sheet, set the imported session,
    /// and switch to the Sous Chef tab. Must NOT be @Sendable because
    /// it mutates @State properties that are main-actor-isolated.
    let onImported: (ChatSessionResponse) -> Void

    @State private var viewModel = ImportViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                switch method {
                case .url:
                    urlImportContent
                case .text:
                    textImportContent
                case .photo:
                    photoImportContent
                }
            }
            .navigationTitle(navigationTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .disabled(viewModel.isLoading)
            .task {
                // Auto-fill and start import if a URL was pre-filled
                // (e.g., from the clipboard banner).
                if let prefillURL, method == .url {
                    viewModel.urlText = prefillURL
                    await viewModel.importFromURL(onImported: onImported)
                }
            }
        }
    }

    private var navigationTitle: String {
        switch method {
        case .url: "Import from URL"
        case .text: "Import from Text"
        case .photo: "Import from Photo"
        }
    }

    // MARK: - URL Import

    private var urlImportContent: some View {
        VStack(spacing: 24) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Recipe URL")
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundStyle(.secondary)

                TextField("https://example.com/recipe", text: $viewModel.urlText)
                    .textFieldStyle(.roundedBorder)
                    .keyboardType(.URL)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .onSubmit {
                        Task { await viewModel.importFromURL(onImported: onImported) }
                    }
            }

            if let error = viewModel.errorMessage {
                errorBanner(error)
            }

            importButton("Import Recipe") {
                await viewModel.importFromURL(onImported: onImported)
            }

            Spacer()

            Text("Paste a URL from any recipe website. We'll extract the recipe and create an editable version for you.")
                .font(.footnote)
                .foregroundStyle(.tertiary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)
        }
        .padding()
    }

    // MARK: - Text Import

    private var textImportContent: some View {
        VStack(spacing: 24) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Recipe Text")
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundStyle(.secondary)

                TextEditor(text: $viewModel.pastedText)
                    .frame(minHeight: 200)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(Color(.systemGray4), lineWidth: 1)
                    )
                    .overlay(alignment: .topLeading) {
                        if viewModel.pastedText.isEmpty {
                            Text("Paste your recipe here...")
                                .foregroundStyle(.tertiary)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 12)
                                .allowsHitTesting(false)
                        }
                    }
            }

            if let error = viewModel.errorMessage {
                errorBanner(error)
            }

            importButton("Import Recipe") {
                await viewModel.importFromText(onImported: onImported)
            }
        }
        .padding()
    }

    // MARK: - Photo Import

    /// Two acquisition paths: live camera capture or photo library pick.
    /// Once an image is loaded (from either source), shows a preview
    /// and the "Import Recipe" button.
    private var photoImportContent: some View {
        VStack(spacing: 24) {
            if let image = viewModel.capturedImage {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(maxHeight: 300)
                    .clipShape(RoundedRectangle(cornerRadius: 12))

                importButton("Import Recipe") {
                    await viewModel.importFromPhoto(
                        image: image,
                        onImported: onImported
                    )
                }

                Button("Choose a Different Photo") {
                    viewModel.capturedImage = nil
                    viewModel.selectedPhotoItem = nil
                }
                .font(.footnote)
            } else {
                VStack(spacing: 12) {
                    // Camera capture (only on devices with a camera)
                    if UIImagePickerController.isSourceTypeAvailable(.camera) {
                        Button {
                            viewModel.showCamera = true
                        } label: {
                            Label("Take Photo", systemImage: "camera")
                                .frame(maxWidth: .infinity)
                                .padding()
                                .background(.ultraThinMaterial)
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                        }
                    }

                    // Photo library picker
                    PhotosPicker(
                        selection: $viewModel.selectedPhotoItem,
                        matching: .images
                    ) {
                        Label("Choose from Library", systemImage: "photo.on.rectangle")
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(.ultraThinMaterial)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                    .onChange(of: viewModel.selectedPhotoItem) { _, newItem in
                        Task {
                            if let data = try? await newItem?.loadTransferable(type: Data.self),
                               let uiImage = UIImage(data: data) {
                                viewModel.capturedImage = uiImage
                            }
                        }
                    }
                }

                Text("Snap a photo of a cookbook page or recipe card, or choose an existing photo from your library.")
                    .font(.footnote)
                    .foregroundStyle(.tertiary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }

            if let error = viewModel.errorMessage {
                errorBanner(error)
            }

            Spacer()
        }
        .padding()
        .fullScreenCover(isPresented: $viewModel.showCamera) {
            CameraCapture(image: $viewModel.capturedImage)
                .ignoresSafeArea()
        }
    }

    // MARK: - Shared Components

    private func importButton(_ title: String, action: @escaping () async -> Void) -> some View {
        Button {
            Task { await action() }
        } label: {
            if viewModel.isLoading {
                ProgressView()
                    .tint(.white)
                    .frame(maxWidth: .infinity)
                    .padding()
            } else {
                Text(title)
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity)
                    .padding()
            }
        }
        .buttonStyle(.borderedProminent)
        .disabled(viewModel.isLoading)
    }

    private func errorBanner(_ message: String) -> some View {
        HStack {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
            Text(message)
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding()
        .background(.orange.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

// MARK: - Camera Capture

/// UIKit camera wrapper. Presents UIImagePickerController with .camera source.
/// Binds the captured image back to SwiftUI state.
struct CameraCapture: UIViewControllerRepresentable {
    @Binding var image: UIImage?
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraCapture

        init(_ parent: CameraCapture) {
            self.parent = parent
        }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            if let uiImage = info[.originalImage] as? UIImage {
                parent.image = uiImage
            }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.dismiss()
        }
    }
}
