import Foundation
import Supabase
import Auth

@Observable
final class AuthManager {
    private(set) var isInitialized = false
    private(set) var session: Session?
    private(set) var authError: String?

    private let supabaseClient: SupabaseClient

    var isAuthenticated: Bool {
        guard let session else { return false }
        return session.user.email != nil && !session.accessToken.isEmpty
    }

    var user: User? {
        session?.user
    }

    var userEmail: String? {
        session?.user.email
    }

    init(supabaseClient: SupabaseClient) {
        self.supabaseClient = supabaseClient
    }

    // MARK: - Bootstrap

    func bootstrap() async {
        do {
            let session = try await supabaseClient.auth.session
            if isValidSession(session) {
                self.session = session
            } else {
                try await supabaseClient.auth.signOut(scope: .local)
                self.session = nil
            }
        } catch let error as AuthError {
            // Missing session on first launch is normal — just needs sign-in
            session = nil
        } catch let error as URLError {
            // Real network error
            authError = error.localizedDescription
            session = nil
        } catch {
            // Other errors — only flag as auth error if it looks like a real issue
            let message = error.localizedDescription
            if message.lowercased().contains("session") || message.lowercased().contains("missing") {
                session = nil
            } else {
                authError = message
                session = nil
            }
        }
        isInitialized = true

        // Listen for auth state changes
        listenForAuthChanges()
    }

    // MARK: - Sign In

    func signIn(email: String, password: String) async -> String? {
        do {
            let session = try await supabaseClient.auth.signIn(email: email, password: password)
            if isValidSession(session) {
                self.session = session
                authError = nil
                return nil
            } else {
                try await supabaseClient.auth.signOut(scope: .local)
                return "Invalid session. Please try again."
            }
        } catch {
            return error.localizedDescription
        }
    }

    // MARK: - Sign Up

    func signUp(email: String, password: String) async -> String? {
        do {
            let result = try await supabaseClient.auth.signUp(email: email, password: password)
            if let session = result.session, isValidSession(session) {
                self.session = session
                authError = nil
                return nil
            } else {
                return "Account created. Please check your email to verify."
            }
        } catch {
            return error.localizedDescription
        }
    }

    // MARK: - Sign Out

    func signOut() async {
        do {
            try await supabaseClient.auth.signOut(scope: .local)
        } catch {
            // Best-effort local sign-out
        }
        session = nil
    }

    // MARK: - Private

    private func isValidSession(_ session: Session) -> Bool {
        session.user.email != nil && !session.accessToken.isEmpty
    }

    private func listenForAuthChanges() {
        Task { [weak self] in
            guard let self else { return }
            for await (_, session) in supabaseClient.auth.authStateChanges {
                await MainActor.run {
                    if let session, self.isValidSession(session) {
                        self.session = session
                    } else if session != nil {
                        // Invalid session — clear it
                        Task { try? await self.supabaseClient.auth.signOut(scope: .local) }
                        self.session = nil
                    } else {
                        self.session = nil
                    }
                }
            }
        }
    }
}
