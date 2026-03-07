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
        guard let token = AuthManager.shared.accessToken else {
            throw NetworkError.noAccessToken
        }

        let data = try await rawRequest(
            path,
            method: method,
            body: body,
            queryItems: queryItems,
            authToken: token
        )
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
        guard let token = AuthManager.shared.accessToken else {
            throw NetworkError.noAccessToken
        }

        _ = try await rawRequest(
            path,
            method: method,
            body: body,
            queryItems: queryItems,
            authToken: token
        )
    }

    func requestWithoutAuth<T: Decodable>(
        _ path: String,
        method: HTTPMethod = .get,
        body: (any Encodable)? = nil,
        queryItems: [URLQueryItem]? = nil
    ) async throws -> T {
        let data = try await rawRequest(
            path,
            method: method,
            body: body,
            queryItems: queryItems,
            authToken: nil
        )

        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw NetworkError.decodingFailed(error)
        }
    }

    // MARK: - Raw Request

    private func rawRequest(
        _ path: String,
        method: HTTPMethod,
        body: (any Encodable)?,
        queryItems: [URLQueryItem]?,
        authToken: String?
    ) async throws -> Data {
        var components = URLComponents(string: baseURL + path)
        if let queryItems, !queryItems.isEmpty {
            components?.queryItems = queryItems
        }

        guard let url = components?.url else {
            throw NetworkError.invalidURL(path)
        }

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = method.rawValue
        if let authToken {
            urlRequest.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        }
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.setValue(TimeZone.current.identifier, forHTTPHeaderField: "X-Timezone")
        urlRequest.setValue(InstallIdentity.shared.installId, forHTTPHeaderField: "X-Install-Id")

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

// MARK: - First-Party Behavior Telemetry

@MainActor
final class BehaviorTelemetry {

    static let shared = BehaviorTelemetry()

    private let maxBatchSize = 10
    private let flushDelayNs: UInt64 = 5_000_000_000
    private let formatter: ISO8601DateFormatter

    private var queue: [BehaviorTelemetryEventRequest] = []
    private var scheduledFlushTask: Task<Void, Never>?

    private init() {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        self.formatter = formatter
    }

    func track(
        eventType: String,
        surface: String,
        sessionId: String? = nil,
        entityType: String? = nil,
        entityId: String? = nil,
        sourceSurface: String? = nil,
        algorithmVersion: String? = nil,
        payload: [String: AnyCodableValue]? = nil
    ) {
        queue.append(
            BehaviorTelemetryEventRequest(
                eventId: UUID().uuidString,
                eventType: eventType,
                surface: surface,
                occurredAt: formatter.string(from: .now),
                sessionId: sessionId,
                entityType: entityType,
                entityId: entityId,
                sourceSurface: sourceSurface,
                algorithmVersion: algorithmVersion,
                payload: payload
            )
        )

        if queue.count >= maxBatchSize {
            Task { await flush() }
        } else {
            scheduleFlush()
        }
    }

    func flush() async {
        scheduledFlushTask?.cancel()
        scheduledFlushTask = nil

        guard !queue.isEmpty else { return }

        let batch = Array(queue.prefix(maxBatchSize))
        queue.removeFirst(batch.count)

        do {
            let _: BehaviorTelemetryBatchResponse = try await APIClient.shared.request(
                "/telemetry/behavior",
                method: .post,
                body: BehaviorTelemetryBatchRequest(
                    installId: InstallIdentity.shared.installId,
                    events: batch
                )
            )
        } catch {
            queue.insert(contentsOf: batch, at: 0)
            scheduleFlush()
            return
        }

        if !queue.isEmpty {
            scheduleFlush()
        }
    }

    private func scheduleFlush() {
        guard scheduledFlushTask == nil else { return }

        scheduledFlushTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: flushDelayNs)
            await flush()
        }
    }
}

// MARK: - Install Identity

@MainActor
final class InstallIdentity {

    static let shared = InstallIdentity()

    private let installIdKey = "alchemy.install_id"
    private let defaults = UserDefaults.standard

    private init() {}

    var installId: String {
        if let existing = defaults.string(forKey: installIdKey), !existing.isEmpty {
            return existing
        }

        let created = UUID().uuidString.lowercased()
        defaults.set(created, forKey: installIdKey)
        return created
    }
}

// MARK: - Anonymous Install Telemetry

@MainActor
final class InstallTelemetry {

    static let shared = InstallTelemetry()

    private let maxBatchSize = 10
    private let flushDelayNs: UInt64 = 5_000_000_000
    private let firstOpenTrackedKey = "alchemy.install.first_open_tracked"
    private let formatter: ISO8601DateFormatter

    private var queue: [InstallTelemetryEventRequest] = []
    private var scheduledFlushTask: Task<Void, Never>?

    private init() {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        self.formatter = formatter
    }

    func trackFirstOpenIfNeeded(
        acquisitionChannel: String = "unknown",
        campaignToken: String? = nil,
        providerToken: String? = nil
    ) {
        guard !UserDefaults.standard.bool(forKey: firstOpenTrackedKey) else { return }

        UserDefaults.standard.set(true, forKey: firstOpenTrackedKey)
        enqueue(
            eventType: "app_first_open",
            payload: defaultPayload(
                acquisitionChannel: acquisitionChannel,
                campaignToken: campaignToken,
                providerToken: providerToken
            )
        )

        Task { await flush() }
    }

    func trackSessionStarted(acquisitionChannel: String = "unknown") {
        enqueue(
            eventType: "app_session_started",
            payload: defaultPayload(acquisitionChannel: acquisitionChannel)
        )
    }

    func flush() async {
        scheduledFlushTask?.cancel()
        scheduledFlushTask = nil

        guard !queue.isEmpty else { return }

        let batch = Array(queue.prefix(maxBatchSize))
        queue.removeFirst(batch.count)

        do {
            let _: BehaviorTelemetryBatchResponse = try await APIClient.shared.requestWithoutAuth(
                "/telemetry/install",
                method: .post,
                body: InstallTelemetryBatchRequest(
                    installId: InstallIdentity.shared.installId,
                    events: batch
                )
            )
        } catch {
            queue.insert(contentsOf: batch, at: 0)
            scheduleFlush()
            return
        }

        if !queue.isEmpty {
            scheduleFlush()
        }
    }

    private func enqueue(
        eventType: String,
        payload: [String: AnyCodableValue]?
    ) {
        queue.append(
            InstallTelemetryEventRequest(
                eventId: UUID().uuidString,
                eventType: eventType,
                occurredAt: formatter.string(from: .now),
                payload: payload
            )
        )

        if queue.count >= maxBatchSize {
            Task { await flush() }
        } else {
            scheduleFlush()
        }
    }

    private func scheduleFlush() {
        guard scheduledFlushTask == nil else { return }

        scheduledFlushTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: flushDelayNs)
            await flush()
        }
    }

    private func defaultPayload(
        acquisitionChannel: String,
        campaignToken: String? = nil,
        providerToken: String? = nil
    ) -> [String: AnyCodableValue] {
        var payload: [String: AnyCodableValue] = [
            "acquisition_channel": .string(acquisitionChannel),
            "app_version": .string(bundleString("CFBundleShortVersionString") ?? "unknown"),
            "build_number": .string(bundleString("CFBundleVersion") ?? "unknown"),
            "os_version": .string(ProcessInfo.processInfo.operatingSystemVersionString),
            "locale": .string(Locale.current.identifier),
            "timezone": .string(TimeZone.current.identifier),
        ]

        if let campaignToken, !campaignToken.isEmpty {
            payload["campaign_token"] = .string(campaignToken)
        }

        if let providerToken, !providerToken.isEmpty {
            payload["provider_token"] = .string(providerToken)
        }

        return payload
    }

    private func bundleString(_ key: String) -> String? {
        (Bundle.main.object(forInfoDictionaryKey: key) as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
