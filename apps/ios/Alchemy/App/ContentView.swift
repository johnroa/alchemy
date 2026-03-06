import SwiftUI

/// Root router that determines which flow to show based on auth + onboarding state.
///
/// Flow: Auth → Onboarding → TabShell
///
/// On app launch, restores the Supabase session. If authenticated, checks
/// onboarding completion via GET /onboarding/state before showing the main app.
struct ContentView: View {
    @State var authManager = AuthManager.shared
    @State private var hasCompletedOnboarding = false
    @State private var isCheckingOnboarding = false

    var body: some View {
        Group {
            if authManager.isLoading {
                loadingView
            } else if !authManager.isAuthenticated {
                AuthFlowView(authManager: authManager)
                    .transition(.opacity)
            } else if isCheckingOnboarding {
                loadingView
            } else if !hasCompletedOnboarding {
                OnboardingView(hasCompletedOnboarding: $hasCompletedOnboarding)
                    .transition(.opacity)
            } else {
                TabShell()
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.4), value: authManager.isAuthenticated)
        .animation(.easeInOut(duration: 0.4), value: hasCompletedOnboarding)
        .animation(.easeInOut(duration: 0.3), value: isCheckingOnboarding)
        .task {
            await authManager.restoreSession()
        }
        .onChange(of: authManager.isAuthenticated) { _, isAuth in
            if isAuth {
                Task { await checkOnboardingState() }
            } else {
                hasCompletedOnboarding = false
            }
        }
    }

    private var loadingView: some View {
        ZStack {
            AlchemyColors.background.ignoresSafeArea()
            ProgressView()
                .tint(.white)
        }
    }

    /// Checks the onboarding completion state from the API.
    /// Falls back to showing onboarding if the request fails.
    private func checkOnboardingState() async {
        isCheckingOnboarding = true
        defer { isCheckingOnboarding = false }

        do {
            let state: OnboardingStateResponse = try await APIClient.shared.request(
                "/onboarding/state"
            )
            hasCompletedOnboarding = state.completed
        } catch {
            // If we can't check, show onboarding to be safe.
            // Common on first launch before any onboarding data exists.
            hasCompletedOnboarding = false
            print("[ContentView] onboarding state check failed: \(error)")
        }
    }
}
