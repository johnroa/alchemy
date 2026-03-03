import Foundation

enum APIError: LocalizedError {
    case notAuthenticated
    case invalidURL
    case serverError(statusCode: Int, message: String)
    case decodingError(Error)
    case networkError(Error)

    var errorDescription: String? {
        switch self {
        case .notAuthenticated:
            "You are not signed in. Please sign in to continue."
        case .invalidURL:
            "Invalid request URL."
        case .serverError(_, let message):
            message
        case .decodingError(let error):
            "Failed to parse response: \(error.localizedDescription)"
        case .networkError(let error):
            error.localizedDescription
        }
    }
}
