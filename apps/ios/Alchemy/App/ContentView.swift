import SwiftUI

struct ContentView: View {
    @Environment(AuthManager.self) private var auth
    @Environment(APIClient.self) private var api

    @State private var onboardingComplete: Bool?

    var body: some View {
        Group {
            if !auth.isInitialized {
                SplashView()
            } else if let error = auth.authError, !auth.isAuthenticated {
                authErrorView(error)
            } else if !auth.isAuthenticated {
                AuthFlowView()
            } else if onboardingComplete == nil {
                SplashView()
                    .task { await checkOnboarding() }
            } else if onboardingComplete == false {
                OnboardingView(onComplete: {
                    withAnimation(.spring(response: 0.5)) {
                        onboardingComplete = true
                    }
                })
            } else {
                TabShell()
            }
        }
        .animation(.easeInOut(duration: 0.3), value: auth.isAuthenticated)
        .animation(.easeInOut(duration: 0.3), value: auth.isInitialized)
        .task {
            await auth.bootstrap()
        }
        .onChange(of: auth.isAuthenticated) { _, isAuth in
            if !isAuth {
                onboardingComplete = nil
            }
        }
    }

    private func checkOnboarding() async {
        do {
            let state = try await api.getOnboardingState()
            withAnimation(.spring(response: 0.4)) {
                onboardingComplete = state.completed
            }
        } catch {
            onboardingComplete = true
        }
    }

    private func authErrorView(_ message: String) -> some View {
        VStack(spacing: Spacing.lg) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 48))
                .foregroundStyle(AlchemyColors.warning)

            Text("Connection Error")
                .font(AlchemyFont.titleMD)
                .foregroundStyle(AlchemyColors.textPrimary)

            Text(message)
                .font(AlchemyFont.bodySmall)
                .foregroundStyle(AlchemyColors.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, Spacing.xl)

            AlchemyButton(title: "Try Again") {
                Task { await auth.bootstrap() }
            }
            .padding(.horizontal, Spacing.xxxl)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(AlchemyColors.deepDark)
    }
}
