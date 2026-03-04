import SwiftUI

struct TabShell: View {
    @Environment(APIClient.self) private var api

    @State private var selectedTab: AlchemyTab = .generate
    @State private var showPreferences = false
    @State private var showSettings = false
    @State private var showProfileMenu = false
    @State private var tabBarVisible = true
    @State private var generateComposerFocused = false

    @State private var tabRevealTask: Task<Void, Never>?

    @State private var generateViewModel = GenerateViewModel()
    @State private var cookbookViewModel = CookbookViewModel()

    @StateObject private var keyboard = KeyboardMonitor()

    var body: some View {
        ZStack(alignment: .bottom) {
            Group {
                switch selectedTab {
                case .cookbook:
                    CookbookView(
                        viewModel: cookbookViewModel,
                        onProfileTap: {
                            withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                                showProfileMenu.toggle()
                            }
                        }
                    )
                case .generate:
                    GenerateView(
                        viewModel: generateViewModel,
                        onProfileTap: {
                            withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                                showProfileMenu.toggle()
                            }
                        },
                        onComposerFocusChange: { focused in
                            generateComposerFocused = focused
                        },
                        onGoToCookbook: { committedIds in
                            withAnimation(.easeInOut(duration: 0.2)) {
                                selectedTab = .cookbook
                            }
                            Task { @MainActor in
                                await cookbookViewModel.refreshAfterCommit(
                                    api: api,
                                    committedRecipeIds: committedIds
                                )
                            }
                        }
                    )
                }
            }
            .environmentObject(keyboard)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .animation(.easeInOut(duration: 0.2), value: selectedTab)

            AlchemyTabBar(selectedTab: $selectedTab)
                .opacity(tabBarVisible ? 1 : 0)
                .offset(y: tabBarVisible ? 0 : 24)
                .scaleEffect(tabBarVisible ? 1 : 0.97, anchor: .bottom)
                .allowsHitTesting(tabBarVisible)
                .zIndex(10)
                .ignoresSafeArea(.keyboard, edges: .bottom)

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
        .ignoresSafeArea(.keyboard, edges: .bottom)
        .background(AlchemyColors.deepDark)
        .sheet(isPresented: $showPreferences) {
            PreferencesView()
        }
        .sheet(isPresented: $showSettings) {
            SettingsView()
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.88), value: showProfileMenu)
        .onChange(of: selectedTab) { _, tab in
            if tab != .generate {
                generateComposerFocused = false
            }
        }
        .onChange(of: keyboard.isVisible) { _, isVisible in
            let shouldHide = isVisible || generateComposerFocused
            if shouldHide {
                tabRevealTask?.cancel()
                tabRevealTask = nil
                tabBarVisible = false
                return
            }

            tabRevealTask?.cancel()
            tabRevealTask = Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(70))
                guard !keyboard.isVisible && !generateComposerFocused else { return }
                withAnimation(.spring(response: 0.4, dampingFraction: 0.84)) {
                    tabBarVisible = true
                }
            }
        }
        .onChange(of: generateComposerFocused) { _, focused in
            if focused {
                tabRevealTask?.cancel()
                tabRevealTask = nil
                tabBarVisible = false
                return
            }

            guard !keyboard.isVisible else { return }
            tabRevealTask?.cancel()
            tabRevealTask = Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(70))
                guard !keyboard.isVisible && !generateComposerFocused else { return }
                withAnimation(.spring(response: 0.4, dampingFraction: 0.84)) {
                    tabBarVisible = true
                }
            }
        }
        .onAppear {
            tabBarVisible = !(keyboard.isVisible || generateComposerFocused)
        }
        .onDisappear {
            tabRevealTask?.cancel()
            tabRevealTask = nil
        }
    }
}
