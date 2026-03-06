import Foundation

/// Maps to the API gateway's ErrorEnvelope: `{ code, message, details?, request_id }`.
/// Every non-2xx response from api.cookwithalchemy.com returns this shape.
struct APIError: Error, Decodable, LocalizedError {
    let code: String
    let message: String
    let details: String?
    let requestId: String?

    enum CodingKeys: String, CodingKey {
        case code, message, details
        case requestId = "request_id"
    }

    var errorDescription: String? { message }
}

/// Client-side errors that can occur before or outside the API response.
enum NetworkError: Error, LocalizedError {
    case noAccessToken
    case invalidURL(String)
    case decodingFailed(Error)
    case unexpectedStatusCode(Int, Data)
    case noData

    var errorDescription: String? {
        switch self {
        case .noAccessToken:
            return "Not authenticated. Please sign in."
        case .invalidURL(let path):
            return "Invalid URL: \(path)"
        case .decodingFailed(let error):
            return "Failed to parse response: \(error.localizedDescription)"
        case .unexpectedStatusCode(let code, _):
            return "Unexpected response (HTTP \(code))"
        case .noData:
            return "No data received from server."
        }
    }
}
