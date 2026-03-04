import Foundation
import Supabase

@Observable
final class APIClient {
    private let baseURL: String
    private let supabaseClient: SupabaseClient
    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        return d
    }()

    private struct ErrorEnvelope: Decodable {
        let code: String
        let message: String
        let requestId: String?

        enum CodingKeys: String, CodingKey {
            case code, message
            case requestId = "request_id"
        }
    }

    init(baseURL: String = AppEnvironment.apiBaseURL, supabaseClient: SupabaseClient) {
        self.baseURL = baseURL.hasSuffix("/") ? String(baseURL.dropLast()) : baseURL
        self.supabaseClient = supabaseClient
    }

    // MARK: - Generic Request

    func request<T: Decodable>(_ method: String = "GET", path: String, body: (any Encodable)? = nil) async throws -> T {
        guard let url = URL(string: "\(baseURL)\(path)") else {
            throw APIError.invalidURL
        }

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = method
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")

        // Inject bearer token
        let token = try await getAccessToken()
        urlRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        if let body {
            urlRequest.httpBody = try JSONEncoder().encode(body)
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: urlRequest)
        } catch {
            throw APIError.networkError(error)
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.networkError(URLError(.badServerResponse))
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            let envelope = parseErrorEnvelope(from: data)
            let message = envelope?.message ?? "Request failed"
            if httpResponse.statusCode == 401 {
                throw APIError.notAuthenticated
            }
            throw APIError.serverError(
                statusCode: httpResponse.statusCode,
                code: envelope?.code,
                message: message,
                requestId: envelope?.requestId
            )
        }

        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }

    // MARK: - Cookbook

    func getCookbook() async throws -> CookbookResponse {
        try await request(path: "/recipes/cookbook?limit=50")
    }

    func getRecipe(_ id: String) async throws -> RecipeView {
        try await request(path: "/recipes/\(id)")
    }

    func getRecipeHistory(_ id: String) async throws -> RecipeHistoryResponse {
        try await request(path: "/recipes/\(id)/history")
    }

    // MARK: - Chat

    func createChat(message: String) async throws -> ChatSession {
        try await request("POST", path: "/chat", body: ["message": message])
    }

    func getChat(id: String) async throws -> ChatSession {
        try await request(path: "/chat/\(id)")
    }

    func sendChatMessage(chatId: String, message: String) async throws -> ChatSession {
        try await request("POST", path: "/chat/\(chatId)/messages", body: ["message": message])
    }

    func patchCandidate(chatId: String, requestBody: PatchCandidateRequest) async throws -> ChatSession {
        try await request("PATCH", path: "/chat/\(chatId)/candidate", body: requestBody)
    }

    func commitChat(chatId: String) async throws -> CommitChatRecipesResponse {
        try await request("POST", path: "/chat/\(chatId)/commit", body: EmptyBody())
    }

    // MARK: - Recipe Actions

    func saveRecipe(id: String) async throws -> SaveResponse {
        try await request("POST", path: "/recipes/\(id)/save")
    }

    func unsaveRecipe(id: String) async throws -> SaveResponse {
        try await request("DELETE", path: "/recipes/\(id)/save")
    }

    func addAttachment(recipeId: String, relationType: String, prompt: String? = nil, position: Int? = nil) async throws -> AttachmentResponse {
        var body: [String: String] = ["relation_type": relationType]
        if let prompt { body["prompt"] = prompt }
        if let position { body["position"] = String(position) }
        return try await request("POST", path: "/recipes/\(recipeId)/attachments", body: body)
    }

    func setCategoryOverride(recipeId: String, category: String) async throws -> OkResponse {
        try await request("POST", path: "/recipes/\(recipeId)/categories/override", body: ["category": category])
    }

    // MARK: - Preferences

    func getPreferences() async throws -> PreferenceProfile {
        try await request(path: "/preferences")
    }

    func updatePreferences(_ profile: PreferenceProfile) async throws -> PreferenceProfile {
        try await request("PATCH", path: "/preferences", body: profile)
    }

    // MARK: - Memories

    func getMemories() async throws -> MemoriesResponse {
        try await request(path: "/memories")
    }

    func resetMemories() async throws -> OkResponse {
        try await request("POST", path: "/memories/reset", body: EmptyBody())
    }

    // MARK: - Changelog

    func getChangelog() async throws -> ChangelogResponse {
        try await request(path: "/changelog")
    }

    // MARK: - Onboarding

    func getOnboardingState() async throws -> OnboardingState {
        try await request(path: "/onboarding/state")
    }

    func sendOnboardingMessage(message: String, transcript: [OnboardingChatMessage], state: [String: JSONValue]? = nil) async throws -> OnboardingChatResponse {
        let body = OnboardingChatBody(message: message, transcript: transcript, state: state)
        return try await request("POST", path: "/onboarding/chat", body: body)
    }

    // MARK: - Private

    private func getAccessToken() async throws -> String {
        let session = try await supabaseClient.auth.session
        return session.accessToken
    }

    private func parseErrorEnvelope(from data: Data) -> ErrorEnvelope? {
        try? decoder.decode(ErrorEnvelope.self, from: data)
    }
}

// MARK: - Request Bodies

private struct EmptyBody: Encodable {}

private struct OnboardingChatBody: Encodable {
    let message: String
    let transcript: [OnboardingChatMessage]
    var state: [String: JSONValue]?
}
