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
    /// Pending import from the share extension, delivered via alchemy:// URL scheme.
    /// Consumed by TabShell once the main app is ready.
    @State private var pendingImportURL: URL?

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
                TabShell(pendingImportURL: $pendingImportURL)
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.4), value: authManager.isAuthenticated)
        .animation(.easeInOut(duration: 0.4), value: hasCompletedOnboarding)
        .animation(.easeInOut(duration: 0.3), value: isCheckingOnboarding)
        .task {
            await authManager.restoreSession()
        }
        .onOpenURL { url in
            // Handle alchemy://import?kind=url|text|photo from share extension
            if url.scheme == "alchemy" && url.host == "import" {
                pendingImportURL = url
            }
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
