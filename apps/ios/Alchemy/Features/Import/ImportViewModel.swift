import Foundation
import PhotosUI
import SwiftUI

/// Manages the import pipeline lifecycle: validates input, uploads photos
/// to Supabase Storage if needed, calls POST /chat/import, and delivers
/// a seeded ChatSessionResponse to the caller.
///
/// The view model does NOT hold the imported session — it passes it back
/// via the `onImported` closure so TabShell can hand it to GenerateView.
@MainActor @Observable
final class ImportViewModel {
    // MARK: - State

    var urlText: String = ""
    var pastedText: String = ""
    var selectedPhotoItem: PhotosPickerItem?
    var capturedImage: UIImage?
    var showCamera = false

    var isLoading = false
    var errorMessage: String?

    // MARK: - Import

    /// Imports a recipe from a URL. Validates the URL, then calls the API.
    func importFromURL(onImported: @escaping (ChatSessionResponse) -> Void) async {
        let trimmed = urlText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            errorMessage = "Please enter a URL"
            return
        }
        guard URL(string: trimmed) != nil else {
            errorMessage = "Invalid URL format"
            return
        }
        guard RecipeURLDetector.isLikelyRecipe(urlString: trimmed) else {
            errorMessage = "That URL doesn't look like a recipe page. Paste a direct recipe link."
            return
        }

        await performImport(
            request: .url(trimmed, origin: "in_app_paste"),
            onImported: onImported
        )
    }

    /// Imports a recipe from pasted text.
    func importFromText(onImported: @escaping (ChatSessionResponse) -> Void) async {
        let trimmed = pastedText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            errorMessage = "Please paste some recipe text"
            return
        }
        guard trimmed.count <= 50_000 else {
            errorMessage = "Text is too long (max 50,000 characters)"
            return
        }

        await performImport(
            request: .text(trimmed, origin: "in_app_paste"),
            onImported: onImported
        )
    }

    /// Imports a recipe from a photo. Uploads the image to Supabase Storage
    /// first, then passes the storage reference to the API.
    func importFromPhoto(
        image: UIImage,
        onImported: @escaping (ChatSessionResponse) -> Void
    ) async {
        guard let jpegData = image.jpegData(compressionQuality: 0.85) else {
            errorMessage = "Could not process the image"
            return
        }

        isLoading = true
        errorMessage = nil

        do {
            // Upload to Supabase Storage's import-source-photos bucket.
            // The file name includes a UUID to avoid collisions.
            let fileName = "imports/\(UUID().uuidString).jpg"
            let storageRef = try await uploadToStorage(
                data: jpegData,
                path: fileName,
                contentType: "image/jpeg"
            )

            await performImport(
                request: .photo(ref: storageRef, origin: "in_app_paste"),
                onImported: onImported
            )
        } catch {
            isLoading = false
            errorMessage = "Failed to upload photo: \(error.localizedDescription)"
        }
    }

    // MARK: - Private

    private func performImport(
        request: ImportRequest,
        onImported: @escaping (ChatSessionResponse) -> Void
    ) async {
        isLoading = true
        errorMessage = nil

        do {
            let response: ChatSessionResponse = try await APIClient.shared.request(
                "/chat/import",
                method: .post,
                body: request
            )
            isLoading = false
            onImported(response)
        } catch let error as NetworkError {
            isLoading = false
            errorMessage = error.localizedDescription
        } catch {
            isLoading = false
            errorMessage = error.localizedDescription
        }
    }

    /// Uploads data to Supabase Storage and returns the storage path.
    /// Uses the APIClient's auth token for the upload request.
    private func uploadToStorage(
        data: Data,
        path: String,
        contentType: String
    ) async throws -> String {
        // Build the Supabase Storage upload URL directly.
        // The storage API is at the same base as our API but different path.
        let storageBaseURL = "https://xrpkilgbfohzmibpvnit.supabase.co/storage/v1/object/import-source-photos"
        let fullURLString = "\(storageBaseURL)/\(path)"
        guard let url = URL(string: fullURLString) else {
            throw NetworkError.invalidURL(fullURLString)
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.httpBody = data
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")

        if let token = await AuthManager.shared.accessToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (responseData, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 500
            throw NetworkError.unexpectedStatusCode(statusCode, responseData)
        }

        return path
    }
}
