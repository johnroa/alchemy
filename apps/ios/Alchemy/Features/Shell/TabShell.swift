import SwiftUI

struct TabShell: View {
    @State private var selectedTab: AlchemyTab = .generate
    @State private var showPreferences = false
    @State private var showSettings = false
    @State private var showProfileMenu = false
    @StateObject private var keyboard = KeyboardMonitor()

    // Drive tab-bar visibility continuously from keyboard height to avoid snap/jitter.
    private var keyboardHideProgress: CGFloat {
        let transitionRange: CGFloat = 150
        return min(max(keyboard.height / transitionRange, 0), 1)
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            // Tab content
            Group {
                switch selectedTab {
                case .cookbook:
                    CookbookView(onProfileTap: {
                        withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                            showProfileMenu.toggle()
                        }
                    })
                case .generate:
                    GenerateView(onProfileTap: {
                        withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                            showProfileMenu.toggle()
                        }
                    })
                }
            }
            .environmentObject(keyboard)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .animation(.easeInOut(duration: 0.2), value: selectedTab)

            // Floating tab bar
            AlchemyTabBar(selectedTab: $selectedTab)
                .opacity(1 - keyboardHideProgress)
                .scaleEffect(1 - (0.028 * keyboardHideProgress), anchor: .bottom)
                .offset(y: 20 * keyboardHideProgress)
                .allowsHitTesting(keyboardHideProgress < 0.05)
                .zIndex(10)

            if showProfileMenu {
                Color.black.opacity(0.001)
                    .ignoresSafeArea()
                    .onTapGesture {
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.9)) {
                            showProfileMenu = false
                        }
                    }
                    .zIndex(40)

                VStack {
                    HStack {
                        Spacer()
                        ProfileQuickMenu(
                            onPreferences: {
                                withAnimation(.spring(response: 0.3, dampingFraction: 0.9)) {
                                    showProfileMenu = false
                                }
                                Task { @MainActor in
                                    try? await Task.sleep(for: .milliseconds(140))
                                    showPreferences = true
                                }
                            },
                            onSettings: {
                                withAnimation(.spring(response: 0.3, dampingFraction: 0.9)) {
                                    showProfileMenu = false
                                }
                                Task { @MainActor in
                                    try? await Task.sleep(for: .milliseconds(140))
                                    showSettings = true
                                }
                            }
                        )
                        .transition(
                            .asymmetric(
                                insertion: .scale(scale: 0.84, anchor: .topTrailing).combined(with: .opacity),
                                removal: .scale(scale: 0.92, anchor: .topTrailing).combined(with: .opacity)
                            )
                        )
                    }
                    .padding(.trailing, Spacing.md)
                    .padding(.top, 74)
                    Spacer()
                }
                .zIndex(41)
            }
        }
        .ignoresSafeArea(.container, edges: .bottom)
        .background(AlchemyColors.deepDark)
        .sheet(isPresented: $showPreferences) {
            PreferencesView()
        }
        .sheet(isPresented: $showSettings) {
            SettingsView()
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.88), value: showProfileMenu)
    }
}
