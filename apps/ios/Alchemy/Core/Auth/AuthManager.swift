import Foundation
import Observation
import Supabase
import AuthenticationServices
import CryptoKit

/// Owns the Supabase auth session lifecycle and drives the app's
/// authenticated/unauthenticated state transitions.
///
/// Flow:
///   1. App launch → restoreSession() checks for persisted JWT
///   2. User taps Sign In with Apple → signInWithApple(idToken:nonce:)
///   3. Supabase exchanges Apple token for a session
///   4. onAuthStateChange keeps the JWT refreshed automatically
///   5. signOut() clears the session and returns to the auth screen
@Observable
@MainActor
final class AuthManager {

    // MARK: - Published State

    /// Whether the user has a valid Supabase session.
    private(set) var isAuthenticated = false

    /// True while a sign-in or session restore is in progress.
    private(set) var isLoading = false

    /// User-facing error message from the most recent auth operation.
    private(set) var errorMessage: String?

    /// Current Supabase session, nil when signed out.
    private(set) var currentSession: Session?

    /// Convenience: the JWT access token for API calls.
    var accessToken: String? { currentSession?.accessToken }

    /// Current user's email from the Supabase session.
    var userEmail: String? { currentSession?.user.email }

    /// Current user's display name from Apple Sign In metadata.
    var displayName: String? {
        currentSession?.user.userMetadata["full_name"]?.stringValue
    }

    // MARK: - Singleton

    static let shared = AuthManager()

    // MARK: - Private

    private let supabase: SupabaseClient
    /// Task handle for the auth state listener so it stays alive.
    private var authListenerTask: Task<Void, Never>?

    // MARK: - Init

    private init() {
        self.supabase = SupabaseManager.shared.client
        startAuthListener()
    }

    deinit {
        // authListenerTask is cancelled implicitly when AuthManager is deallocated
        // (which in practice never happens since it's a singleton).
    }

    // MARK: - Session Restore

    /// Called on app launch to check if a persisted session exists.
    /// If the JWT is expired, Supabase automatically refreshes it.
    func restoreSession() async {
        isLoading = true
        defer { isLoading = false }

        do {
            let session = try await supabase.auth.session
            self.currentSession = session
            self.isAuthenticated = true
        } catch {
            // No persisted session or refresh failed — stay signed out.
            self.currentSession = nil
            self.isAuthenticated = false
        }
    }

    // MARK: - Apple Sign In

    /// Exchanges an Apple identity token for a Supabase session.
    /// Called after ASAuthorizationAppleIDProvider completes successfully.
    ///
    /// - Parameters:
    ///   - idToken: The JWT identity token from Apple.
    ///   - nonce: The raw (unhashed) nonce used in the Apple Sign In request.
    func signInWithApple(idToken: String, nonce: String) async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let session = try await supabase.auth.signInWithIdToken(
                credentials: .init(
                    provider: .apple,
                    idToken: idToken,
                    nonce: nonce
                )
            )
            self.currentSession = session
            self.isAuthenticated = true
        } catch {
            self.errorMessage = "Sign in failed. Please try again."
            print("[AuthManager] signInWithApple error: \(error)")
        }
    }

    // MARK: - Sign Out

    func signOut() async {
        do {
            try await supabase.auth.signOut()
        } catch {
            print("[AuthManager] signOut error: \(error)")
        }
        currentSession = nil
        isAuthenticated = false
    }

    // MARK: - Auth State Listener

    /// Subscribes to Supabase auth state changes (token refresh, sign out
    /// from another device, etc.) and keeps local state in sync.
    private func startAuthListener() {
        authListenerTask = Task { [weak self] in
            guard let self else { return }
            for await (event, session) in self.supabase.auth.authStateChanges {
                await MainActor.run {
                    switch event {
                    case .signedIn, .tokenRefreshed:
                        self.currentSession = session
                        self.isAuthenticated = true
                    case .signedOut:
                        self.currentSession = nil
                        self.isAuthenticated = false
                    default:
                        break
                    }
                }
            }
        }
    }
}

// MARK: - Nonce Helpers

extension AuthManager {
    /// Generates a cryptographically random nonce string for Apple Sign In.
    /// Apple requires the nonce to be included in the authorization request
    /// and then hashed (SHA256) before sending. The raw nonce is sent to
    /// Supabase for server-side verification.
    static func randomNonce(length: Int = 32) -> String {
        let charset = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._")
        var result = ""
        var remainingLength = length

        while remainingLength > 0 {
            var randoms = [UInt8](repeating: 0, count: 16)
            let status = SecRandomCopyBytes(kSecRandomDefault, randoms.count, &randoms)
            guard status == errSecSuccess else { continue }

            for random in randoms {
                guard remainingLength > 0 else { break }
                if random < charset.count {
                    result.append(charset[Int(random)])
                    remainingLength -= 1
                }
            }
        }
        return result
    }

    /// SHA256 hash of the nonce, hex-encoded for the Apple Sign In request.
    static func sha256(_ input: String) -> String {
        let data = Data(input.utf8)
        let hash = SHA256.hash(data: data)
        return hash.map { String(format: "%02x", $0) }.joined()
    }
}
