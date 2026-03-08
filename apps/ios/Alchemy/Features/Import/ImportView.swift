import PhotosUI
import SwiftUI

struct ImportView: View {
    let method: ImportMethod
    var prefillURL: String? = nil
    let onImported: (ChatSessionResponse) -> Void

    @State private var viewModel = ImportViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                switch method {
                case .url:  urlContent
                case .text: textContent
                case .photo: photoContent
                }
                Spacer()
            }
            .padding(.horizontal, 20)
            .padding(.top, 20)
            .navigationTitle(navigationTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .disabled(viewModel.isLoading)
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
            .task {
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

    // MARK: - URL

    private var urlContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Paste a recipe link and Sous Chef will import it.")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            TextField("https://example.com/recipe", text: $viewModel.urlText)
                .keyboardType(.URL)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .textFieldStyle(.roundedBorder)
                .submitLabel(.go)
                .onSubmit {
                    Task { await viewModel.importFromURL(onImported: onImported) }
                }

            if let error = viewModel.errorMessage {
                errorLabel(error)
            }

            actionButton("Import Recipe") {
                await viewModel.importFromURL(onImported: onImported)
            }
        }
    }

    // MARK: - Text

    private var textContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            TextEditor(text: $viewModel.pastedText)
                .frame(minHeight: 180)
                .scrollContentBackground(.hidden)
                .padding(8)
                .background(Color(.systemGray6))
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(alignment: .topLeading) {
                    if viewModel.pastedText.isEmpty {
                        Text("Paste your recipe here...")
                            .foregroundStyle(.tertiary)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 16)
                            .allowsHitTesting(false)
                    }
                }

            if let error = viewModel.errorMessage {
                errorLabel(error)
            }

            actionButton("Import Recipe") {
                await viewModel.importFromText(onImported: onImported)
            }
        }
    }

    // MARK: - Photo

    private var photoContent: some View {
        VStack(spacing: 16) {
            if let image = viewModel.capturedImage {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(maxHeight: 260)
                    .clipShape(RoundedRectangle(cornerRadius: 12))

                actionButton("Import Recipe") {
                    await viewModel.importFromPhoto(image: image, onImported: onImported)
                }

                Button("Choose a Different Photo") {
                    viewModel.capturedImage = nil
                    viewModel.selectedPhotoItem = nil
                }
                .font(.footnote)
            } else {
                if UIImagePickerController.isSourceTypeAvailable(.camera) {
                    Button {
                        viewModel.showCamera = true
                    } label: {
                        Label("Take Photo", systemImage: "camera")
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                    }
                    .buttonStyle(.bordered)
                }

                PhotosPicker(
                    selection: $viewModel.selectedPhotoItem,
                    matching: .images
                ) {
                    Label("Choose from Library", systemImage: "photo.on.rectangle")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                }
                .buttonStyle(.bordered)
                .onChange(of: viewModel.selectedPhotoItem) { _, newItem in
                    Task {
                        if let data = try? await newItem?.loadTransferable(type: Data.self),
                           let uiImage = UIImage(data: data) {
                            viewModel.capturedImage = uiImage
                        }
                    }
                }

                Text("Snap a photo of a cookbook page or recipe card.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if let error = viewModel.errorMessage {
                errorLabel(error)
            }
        }
        .fullScreenCover(isPresented: $viewModel.showCamera) {
            CameraCapture(image: $viewModel.capturedImage)
                .ignoresSafeArea()
        }
    }

    // MARK: - Shared

    private func actionButton(_ title: String, action: @escaping () async -> Void) -> some View {
        Button {
            Task { await action() }
        } label: {
            if viewModel.isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
            } else {
                Text(title)
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
            }
        }
        .buttonStyle(.borderedProminent)
        .disabled(viewModel.isLoading)
    }

    private func errorLabel(_ message: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
            Text(message)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

// MARK: - Camera Capture

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
