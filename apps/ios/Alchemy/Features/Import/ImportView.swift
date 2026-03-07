import PhotosUI
import SwiftUI

/// Modal sheet for importing recipes from URLs, photos, or pasted text.
///
/// Presented by TabShell after the user taps the import dialog action.
/// On successful import, calls `onImported` with the seeded ChatSession,
/// which TabShell uses to navigate to GenerateView with the imported recipe.
struct ImportView: View {
    let method: ImportMethod
    let onImported: @Sendable (ChatSessionResponse) -> Void

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
        }
    }

    private var navigationTitle: String {
        switch method {
        case .url: return "Import from URL"
        case .text: return "Import from Text"
        case .photo: return "Import from Photo"
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
            } else {
                VStack(spacing: 16) {
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

                    Text("Take a photo of a cookbook page or recipe card.")
                        .font(.footnote)
                        .foregroundStyle(.tertiary)
                        .multilineTextAlignment(.center)
                }
            }

            if let error = viewModel.errorMessage {
                errorBanner(error)
            }

            Spacer()
        }
        .padding()
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
