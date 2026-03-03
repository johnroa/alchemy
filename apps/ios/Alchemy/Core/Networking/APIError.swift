import Foundation

enum APIError: LocalizedError {
    case notAuthenticated
    case invalidURL
    case serverError(statusCode: Int, code: String?, message: String, requestId: String?)
    case decodingError(Error)
    case networkError(Error)

    var serverCode: String? {
        guard case .serverError(_, let code, _, _) = self else { return nil }
        return code
    }

    var errorDescription: String? {
        switch self {
        case .notAuthenticated:
            "You are not signed in. Please sign in to continue."
        case .invalidURL:
            "Invalid request URL."
        case .serverError(_, _, let message, _):
            message
        case .decodingError(let error):
            "Failed to parse response: \(error.localizedDescription)"
        case .networkError(let error):
            error.localizedDescription
        }
    }
}
