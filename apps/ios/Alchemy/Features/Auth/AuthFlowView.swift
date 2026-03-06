import SwiftUI
import AuthenticationServices

/// Single-screen authentication using Sign in with Apple → Supabase.
///
/// Layout: branding in the upper third, Apple button in the lower third,
/// dark background. No email/password — Apple is the only auth method.
///
/// The ASAuthorizationAppleIDProvider flow generates a nonce, requests
/// an identity token from Apple, then exchanges it with Supabase via
/// AuthManager.signInWithApple(idToken:nonce:).
struct AuthFlowView: View {
    @Bindable var authManager: AuthManager

    /// Raw (unhashed) nonce generated per sign-in attempt. Sent to Supabase
    /// for server-side verification against the hashed nonce in the Apple JWT.
    @State private var currentNonce: String?

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            VStack(spacing: AlchemySpacing.sm) {
                Image("chef-hat")
                    .renderingMode(.template)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 56, height: 56)
                    .foregroundStyle(AlchemyColors.textPrimary)
                    .padding(.bottom, AlchemySpacing.lg)

                Text("ALCHEMY")
                    .font(AlchemyTypography.displayLarge)
                    .foregroundStyle(AlchemyColors.textPrimary)
                    .kerning(6)

                Text("Cook with intelligence")
                    .font(AlchemyTypography.bodySecondary)
                    .foregroundStyle(AlchemyColors.textSecondary)
            }

            Spacer()
            Spacer()

            if authManager.isLoading {
                ProgressView()
                    .tint(.white)
                    .padding(.bottom, AlchemySpacing.xl)
            } else {
                SignInWithAppleButton(.signIn) { request in
                    let nonce = AuthManager.randomNonce()
                    currentNonce = nonce
                    request.requestedScopes = [.fullName, .email]
                    request.nonce = AuthManager.sha256(nonce)
                } onCompletion: { result in
                    handleAppleSignIn(result)
                }
                .signInWithAppleButtonStyle(.white)
                .frame(height: 52)
                .clipShape(RoundedRectangle(cornerRadius: AlchemySpacing.buttonRadius))
                .padding(.horizontal, AlchemySpacing.screenHorizontal * 1.5)
            }

            if let error = authManager.errorMessage {
                Text(error)
                    .font(AlchemyTypography.caption)
                    .foregroundStyle(.red.opacity(0.9))
                    .padding(.top, AlchemySpacing.sm)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, AlchemySpacing.screenHorizontal)
            }

            Spacer()
        }
        .background(AlchemyColors.background)
    }

    /// Extracts the identity token from Apple's authorization result and
    /// hands it to AuthManager for the Supabase token exchange.
    private func handleAppleSignIn(_ result: Result<ASAuthorization, Error>) {
        switch result {
        case .success(let authorization):
            guard
                let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                let tokenData = credential.identityToken,
                let idToken = String(data: tokenData, encoding: .utf8),
                let nonce = currentNonce
            else {
                return
            }

            Task {
                await authManager.signInWithApple(idToken: idToken, nonce: nonce)
            }

        case .failure(let error):
            // ASAuthorizationError.canceled is normal (user dismissed the sheet)
            if (error as? ASAuthorizationError)?.code != .canceled {
                print("[AuthFlowView] Apple Sign In error: \(error)")
            }
        }
    }
}
