import Foundation

/// Centralized HTTP client for all api.cookwithalchemy.com/v1 calls.
///
/// Reads API_BASE_URL from Info.plist and injects the Supabase JWT as
/// a Bearer token on every request. Uses snake_case ↔ camelCase key
/// conversion so Swift models use idiomatic naming while the API uses
/// snake_case JSON.
///
/// All public methods are async throws — callers handle errors at the
/// call site (loading/error states in views).
@MainActor
final class APIClient {

    static let shared = APIClient()

    private let session: URLSession
    private let baseURL: String
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    private init() {
        // LLM-backed chat endpoints can take 30–90s on cold starts or
        // complex generations. Default URLSession timeout of 60s is too
        // aggressive; 120s gives the backend room to finish.
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 120

        self.session = URLSession(configuration: config)

        self.baseURL = Bundle.main.infoDictionary?["API_BASE_URL"] as? String
            ?? "https://api.cookwithalchemy.com/v1"

        self.decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .iso8601

        self.encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
    }

    // MARK: - Core Request

    /// Performs an authenticated API request and decodes the response.
    ///
    /// - Parameters:
    ///   - path: Relative path appended to baseURL (e.g. "/recipes/cookbook")
    ///   - method: HTTP method (defaults to GET)
    ///   - body: Optional Encodable body for POST/PATCH/PUT
    ///   - queryItems: Optional URL query parameters
    /// - Returns: Decoded response of type T
    func request<T: Decodable>(
        _ path: String,
        method: HTTPMethod = .get,
        body: (any Encodable)? = nil,
        queryItems: [URLQueryItem]? = nil
    ) async throws -> T {
        let data = try await rawRequest(path, method: method, body: body, queryItems: queryItems)
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw NetworkError.decodingFailed(error)
        }
    }

    /// Performs an authenticated API request that returns no meaningful body.
    /// Validates the status code but discards the response data.
    func requestVoid(
        _ path: String,
        method: HTTPMethod = .get,
        body: (any Encodable)? = nil,
        queryItems: [URLQueryItem]? = nil
    ) async throws {
        _ = try await rawRequest(path, method: method, body: body, queryItems: queryItems)
    }

    // MARK: - Raw Request

    private func rawRequest(
        _ path: String,
        method: HTTPMethod,
        body: (any Encodable)?,
        queryItems: [URLQueryItem]?
    ) async throws -> Data {
        guard let token = AuthManager.shared.accessToken else {
            throw NetworkError.noAccessToken
        }

        var components = URLComponents(string: baseURL + path)
        if let queryItems, !queryItems.isEmpty {
            components?.queryItems = queryItems
        }

        guard let url = components?.url else {
            throw NetworkError.invalidURL(path)
        }

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = method.rawValue
        urlRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.setValue(TimeZone.current.identifier, forHTTPHeaderField: "X-Timezone")

        if let body {
            urlRequest.httpBody = try encoder.encode(body)
        }

        let (data, response) = try await session.data(for: urlRequest)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw NetworkError.noData
        }

        // Try to decode an API error envelope on non-2xx responses
        guard (200..<300).contains(httpResponse.statusCode) else {
            if let apiError = try? decoder.decode(APIError.self, from: data) {
                throw apiError
            }
            throw NetworkError.unexpectedStatusCode(httpResponse.statusCode, data)
        }

        return data
    }
}

// MARK: - HTTP Method

enum HTTPMethod: String {
    case get = "GET"
    case post = "POST"
    case patch = "PATCH"
    case put = "PUT"
    case delete = "DELETE"
}
