import SwiftUI

/// Root router that determines which flow to show based on auth/onboarding state.
///
/// Flow: Auth → Onboarding → TabShell
/// For now with dummy data, we use simple boolean flags to simulate state transitions.
/// When the API is wired, these will be driven by Supabase auth session and
/// the GET /onboarding/state endpoint.
struct ContentView: View {
    @State private var isAuthenticated = false
    @State private var hasCompletedOnboarding = false

    var body: some View {
        Group {
            if !isAuthenticated {
                AuthFlowView(isAuthenticated: $isAuthenticated)
                    .transition(.opacity)
            } else if !hasCompletedOnboarding {
                OnboardingView(hasCompletedOnboarding: $hasCompletedOnboarding)
                    .transition(.opacity)
            } else {
                TabShell()
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.4), value: isAuthenticated)
        .animation(.easeInOut(duration: 0.4), value: hasCompletedOnboarding)
    }
}
