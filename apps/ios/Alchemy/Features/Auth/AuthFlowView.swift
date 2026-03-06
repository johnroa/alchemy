import SwiftUI

/// Container for the authentication flow with cross-fade transitions
/// between sign-in and register screens.
///
/// Stub implementation — no API calls. The "Sign In" button immediately
/// sets isAuthenticated to true. When Supabase auth is wired, this will
/// call supabase.auth.signIn() and supabase.auth.signUp().
struct AuthFlowView: View {
    @Binding var isAuthenticated: Bool
    @State private var showRegister = false

    var body: some View {
        Group {
            if showRegister {
                RegisterView(
                    isAuthenticated: $isAuthenticated,
                    showRegister: $showRegister
                )
                .transition(.asymmetric(
                    insertion: .move(edge: .trailing).combined(with: .opacity),
                    removal: .move(edge: .leading).combined(with: .opacity)
                ))
            } else {
                SignInView(
                    isAuthenticated: $isAuthenticated,
                    showRegister: $showRegister
                )
                .transition(.asymmetric(
                    insertion: .move(edge: .leading).combined(with: .opacity),
                    removal: .move(edge: .trailing).combined(with: .opacity)
                ))
            }
        }
        .animation(.easeInOut(duration: 0.35), value: showRegister)
    }
}
