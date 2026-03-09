import SwiftUI
import Lottie

/// Sous Chef screen — the core recipe creation experience.
///
/// State machine driven by the chat API's loop_state:
/// 1. `.chatting` (ideation) — Chat panel at ~75%, skeleton in background
/// 2. `.generating` — Chat hidden, Lottie animation plays
/// 3. `.presenting` — Recipe visible, chat **minimized** (~15%) showing
///    last assistant message + "Want to make changes?" bar
/// 4. `.iterating` — Recipe visible, chat **expanded** (~75%) for tweaks
///
/// The chat panel animates smoothly between minimized and expanded.
/// Tapping the recipe behind an expanded chat minimizes it; tapping
/// "Want to make changes?" expands it. No synthetic briefing messages
/// are injected — the user sees their natural conversation.
///
/// On first open, the chat panel slides up from below the screen.
///
/// API endpoints used:
///   - GET /chat/greeting — personalized opening message
///   - POST /chat — create session + first message
///   - POST /chat/{id}/messages — continue conversation
///   - PATCH /chat/{id}/candidate — switch active component
///   - POST /chat/{id}/commit — save all components to cookbook
struct GenerateView: View {
    @Binding var selectedTab: AppTab
    /// When set by TabShell after a successful import, GenerateView picks up
    /// this seeded session and jumps straight to the `.presenting` phase,
    /// bypassing the initial chat ideation flow. Cleared after consumption.
    @Binding var importedSession: ChatSessionResponse?
    /// Set by commitToCookbook() to pass recipe info to CookbookView
    /// for skeleton rendering. Cleared when the commit API finishes.
    @Binding var pendingSave: PendingSave?

    // MARK: - UI State

    @State private var phase: GeneratePhase = .chatting
    @State private var messages: [ChatMessage] = []
    @State private var inputText = ""
    @State private var showAddToCookbook = false
    @State private var activeComponentIndex = 0
    @State private var showPreferences = false
    @State private var showSettings = false
    @State private var chatHasStarted = false
    @State private var isSending = false
    /// Guards against double-tap on the Save button. Set true on first
    /// commit attempt; never reset (we navigate away on success).
    @State private var isCommitting = false
    /// Populated from AssistantReply.suggestedNextActions after each API
    /// response. Shown as tappable chips above the input bar.
    @State private var suggestedPlaceholder: String?
    @State private var iterationSuggestions: [String] = []
    /// Controls the entry animation: chat panel starts off-screen and
    /// slides up on first appear.
    @State private var hasAppeared = false
    /// Full-screen Lottie splash shown on initial tab entry while the
    /// greeting loads. Fades out before the chat panel slides up.
    @State private var isInitialLoading = true
    /// Whether the chat panel is explicitly expanded by the user via the
    /// chevron toggle. Only relevant in presenting/iterating phases.
    @State private var isChatPanelExpanded = false
    /// Brief toast shown when the API confirms a preference update.
    /// Auto-dismissed after 2.5 seconds.
    @State private var savedToastText: String?
    /// Tracks keyboard height for scroll-to-bottom on keyboard show/hide.
    @State private var keyboardHeight: CGFloat = 0
    /// Index into the rotating placeholder prompts shown before first message.
    @State private var placeholderIndex = Int.random(in: 0..<Self.placeholderPrompts.count)

    @FocusState private var inputFocused: Bool

    // MARK: - API State

    /// Session ID from POST /chat. Nil until the first message is sent.
    @State private var chatSessionId: String?
    /// Current loop state from the API response.
    @State private var loopState: ChatLoopState = .ideation
    /// The candidate recipe set returned when the LLM generates a recipe.
    @State private var candidateSet: APICandidateRecipeSet?
    @State private var imagePollingTask: Task<Void, Never>?

    // MARK: - Layout Constants

    /// Chat panel height when minimized (presenting). Snug fit for the
    /// last assistant ChatBubble + the input prompt bar with minimal chrome.
    private let minimizedChatHeight: CGFloat = 160

    /// Whether the chat panel should be visible at all.
    private var showChatPanel: Bool {
        phase != .generating
    }

    /// Chat panel height when fully expanded (chatting / iterating).
    /// 71.5% of container (up from 65%), capped at 616pt so the panel
    /// never swallows the full screen.
    private func expandedChatHeight(in containerHeight: CGFloat) -> CGFloat {
        max(396, min(containerHeight * 0.715, 616))
    }

    /// Target height for the chat panel based on current phase.
    private func chatPanelHeight(in containerHeight: CGFloat) -> CGFloat {
        switch phase {
        case .chatting: return expandedChatHeight(in: containerHeight)
        case .iterating: return expandedChatHeight(in: containerHeight)
        case .presenting: return isChatPanelExpanded
            ? expandedChatHeight(in: containerHeight)
            : minimizedChatHeight
        case .generating: return 0
        }
    }

    /// True when the chat is showing just the last message + input bar.
    private var isChatMinimized: Bool {
        phase == .presenting && !isChatPanelExpanded
    }

    /// True when the candidate set has more than one component (main + side, etc.)
    private var hasMultipleComponents: Bool {
        (candidateSet?.components.count ?? 0) > 1
    }

    /// The message we want to keep visible in the compact post-generate state.
    /// We prefer the latest completed assistant reply so imports and generation
    /// both show the actual "here's your recipe" message instead of relying on
    /// scroll position through the whole conversation history.
    private var lastAssistantMessage: ChatMessage? {
        messages.last(where: { $0.role == .assistant && !$0.isLoading })
    }

    /// Toggles the chat between minimized (last message visible) and
    /// expanded (full conversation + input) in the presenting phase.
    private func toggleChatPanel() {
        withAnimation(.spring(duration: 0.45, bounce: 0.15)) {
            if isChatPanelExpanded || phase == .iterating {
                phase = .presenting
                isChatPanelExpanded = false
                inputFocused = false
            } else {
                isChatPanelExpanded = true
            }
        }

        if isChatPanelExpanded {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                inputFocused = true
            }
        }
    }

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Color.clear
                    .ignoresSafeArea()
                    .overlay { backgroundContent }

                NavigationStack {
                    ZStack {
                        // Recipe content — shown whenever we have a candidate
                        if phase == .presenting || phase == .iterating {
                            presentedRecipe
                                .contentShape(Rectangle())
                                .onTapGesture {
                                    // Tapping the recipe behind expanded chat
                                    // minimizes it so the user can review.
                                    if phase == .iterating || isChatPanelExpanded {
                                        withAnimation(.spring(duration: 0.45, bounce: 0.15)) {
                                            phase = .presenting
                                            isChatPanelExpanded = false
                                            inputFocused = false
                                        }
                                    }
                                }
                        } else if phase != .generating {
                            Color.clear.allowsHitTesting(false)
                        }

                        // Chat panel — always visible except during generation.
                        // Background applied AFTER maxHeight constraint so the
                        // gradient fills the full panel, not just VStack content.
                        // .ignoresSafeArea(.bottom) is on the background shape only
                        // (extends gradient behind home indicator) — NOT on the
                        // content frame, so keyboard avoidance pushes the panel
                        // above the keyboard instead of hiding it behind.
                        if showChatPanel {
                            chatPanel(containerHeight: geometry.size.height)
                                .frame(maxWidth: .infinity)
                                .frame(maxHeight: chatPanelHeight(in: geometry.size.height))
                                .background(
                                    UnevenRoundedRectangle(
                                        topLeadingRadius: 20,
                                        bottomLeadingRadius: 0,
                                        bottomTrailingRadius: 0,
                                        topTrailingRadius: 20
                                    )
                                    .fill(.ultraThinMaterial)
                                    .overlay {
                                        chatGradientBackground
                                            .clipShape(
                                                UnevenRoundedRectangle(
                                                    topLeadingRadius: 20,
                                                    bottomLeadingRadius: 0,
                                                    bottomTrailingRadius: 0,
                                                    topTrailingRadius: 20
                                                )
                                            )
                                    }
                                    .ignoresSafeArea(edges: .bottom)
                                )
                                .frame(maxHeight: .infinity, alignment: .bottom)
                                // Entry animation: slide up from below on first appear
                                .offset(y: hasAppeared ? 0 : geometry.size.height)
                        }

                        if phase == .generating {
                            generationLoader.transition(.opacity)
                        }
                    }
                    // No coordinate space needed — toggle button replaces drag gesture
                    .containerBackground(.clear, for: .navigation)
                    .toolbarBackground(.hidden, for: .navigationBar)
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar { toolbarContent }
                    .animation(.spring(duration: 0.5, bounce: 0.15), value: phase)
                    .toolbarVisibility(.hidden, for: .tabBar)
                    .sheet(isPresented: $showPreferences) { PreferencesView(selectedTab: $selectedTab) }
                    .sheet(isPresented: $showSettings) { SettingsView() }
                }

                // Initial loading splash — Lottie on top of everything
                // until greeting loads and minimum display time elapses.
                if isInitialLoading {
                    ZStack {
                        AlchemyColors.background.ignoresSafeArea()
                        LottieView(animation: .named("alchemy-loading"))
                            .playing(loopMode: .loop)
                            .frame(width: 120, height: 120)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .transition(.opacity)
                    .zIndex(10)
                }

                // Preference-saved toast — floats above everything
                if let toastText = savedToastText {
                    VStack {
                        HStack(spacing: 6) {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(.green)
                            Text(toastText)
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.white)
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(.ultraThinMaterial, in: Capsule())
                        .shadow(color: .black.opacity(0.2), radius: 12, y: 4)
                        .transition(.move(edge: .top).combined(with: .opacity))

                        Spacer()
                    }
                    .padding(.top, 60)
                }
            }
        }
        .background(AlchemyColors.background)
        .task {
            let startTime = Date()

            // Imported sessions must win over the default greeting flow. If the
            // sheet dismisses and TabShell selects Sous Chef with `importedSession`
            // already populated, plain `.onChange` can miss that initial value.
            // Handling it here ensures the import opens directly in the same
            // post-generate presenting state as a freshly created recipe.
            if let session = importedSession {
                consumeImportedSession(session)
                importedSession = nil
            } else {
                await loadGreeting(focusAfter: false)
            }

            // Ensure the Lottie splash shows for at least 1.5s so it
            // feels intentional, not a flash.
            let elapsed = Date().timeIntervalSince(startTime)
            let remaining = max(0, 1.5 - elapsed)
            if remaining > 0 {
                try? await Task.sleep(for: .seconds(remaining))
            }

            // Fade out the splash, then slide the chat panel up.
            withAnimation(.easeOut(duration: 0.35)) {
                isInitialLoading = false
            }
            try? await Task.sleep(for: .milliseconds(250))

            withAnimation(.spring(duration: 0.6, bounce: 0.2)) {
                hasAppeared = true
            }

            // Focus the input after the chat panel finishes animating in.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                inputFocused = true
            }
        }
        .onDisappear {
            imagePollingTask?.cancel()
        }
        .onChange(of: importedSession?.id) { _, newId in
            guard newId != nil, let session = importedSession else { return }
            consumeImportedSession(session)
            importedSession = nil
        }
        .onChange(of: inputFocused) { _, focused in
            if focused && isChatMinimized {
                withAnimation(.spring(duration: 0.45, bounce: 0.15)) {
                    isChatPanelExpanded = true
                }
                // The expansion moves the TextField from the minimized
                // layout branch to the expanded branch, destroying the
                // old instance and its focus binding. Re-apply focus
                // after the layout settles so the keyboard stays up.
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                    inputFocused = true
                }
            }
        }
        // Keyboard observers — scroll to latest message on show/hide
        .onReceive(
            NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)
        ) { notification in
            if let frame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect {
                keyboardHeight = frame.height
            }
        }
        .onReceive(
            NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)
        ) { _ in
            keyboardHeight = 0
        }
    }

    // MARK: - Background Content

    @ViewBuilder
    private var backgroundContent: some View {
        switch phase {
        case .chatting, .generating:
            recipeSkeleton
        case .presenting, .iterating:
            EmptyView()
        }
    }

    // MARK: - Recipe Skeleton

    private var recipeSkeleton: some View {
        VStack(alignment: .leading, spacing: AlchemySpacing.lg) {
            RoundedRectangle(cornerRadius: AlchemySpacing.cardRadius)
                .fill(AlchemyColors.surfaceSecondary)
                .frame(height: 200)

            RoundedRectangle(cornerRadius: 4)
                .fill(AlchemyColors.surfaceSecondary)
                .frame(width: 200, height: 24)

            RoundedRectangle(cornerRadius: 4)
                .fill(AlchemyColors.surface)
                .frame(width: 280, height: 16)

            ForEach(0..<5, id: \.self) { i in
                HStack {
                    RoundedRectangle(cornerRadius: 4)
                        .fill(AlchemyColors.surface)
                        .frame(width: CGFloat.random(in: 100...160), height: 14)
                    Spacer()
                    RoundedRectangle(cornerRadius: 4)
                        .fill(AlchemyColors.surface)
                        .frame(width: 50, height: 14)
                }
                if i < 4 {
                    Divider().overlay(AlchemyColors.separator)
                }
            }

            Spacer()
        }
        .padding(.horizontal, AlchemySpacing.screenHorizontal)
        .padding(.top, AlchemySpacing.lg)
        .opacity(0.5)
    }

    // MARK: - Presented Recipe

    /// Displays the active candidate component as a RecipeDetailView.
    private var presentedRecipe: some View {
        ZStack(alignment: .top) {
            if let component = activeComponent {
                RecipeDetailView(
                    detail: component.recipe.asDisplayDetail(
                        title: component.title,
                        imageUrl: component.imageUrl,
                        imageStatus: component.imageStatus
                    ),
                    sourceSurface: "chat",
                    sourceSessionId: chatSessionId,
                    showShareButton: false,
                    showTweakBar: false,
                    isEmbedded: true,
                    trackBehavior: false
                )
                .id("\(component.componentId)_\(candidateSet?.revision ?? 0)")
            } else {
                recipeSkeleton
            }

            if let components = candidateSet?.components, components.count > 1 {
                componentTabs(components)
                    .padding(.top, 50)
            }
        }
    }

    /// The currently active candidate component based on tab selection.
    private var activeComponent: APICandidateComponent? {
        guard let components = candidateSet?.components else { return nil }
        let idx = min(activeComponentIndex, components.count - 1)
        return idx >= 0 ? components[idx] : nil
    }

    private func componentTabs(_ components: [APICandidateComponent]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: AlchemySpacing.sm) {
                ForEach(Array(components.enumerated()), id: \.element.id) { index, component in
                    let isMain = component.role.lowercased() == "main"

                    Button {
                        withAnimation { activeComponentIndex = index }
                        Task { await setActiveComponent(component.componentId) }
                    } label: {
                        Text(component.role.capitalized)
                            .font(AlchemyTypography.captionBold)
                            .foregroundStyle(
                                index == activeComponentIndex
                                    ? AlchemyColors.accent
                                    : AlchemyColors.textSecondary
                            )
                            .padding(.horizontal, AlchemySpacing.md)
                            .padding(.vertical, AlchemySpacing.sm)
                    }
                    .glassEffect(
                        index == activeComponentIndex ? .regular : .clear,
                        in: .capsule
                    )
                    .contextMenu {
                        if !isMain {
                            Button(role: .destructive) {
                                Task { await deleteComponent(component.componentId) }
                            } label: {
                                Label("Remove \(component.role.capitalized)", systemImage: "trash")
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, AlchemySpacing.screenHorizontal)
            .padding(.vertical, AlchemySpacing.sm)
        }
    }

    // MARK: - Unified Chat Panel

    /// Single chat panel that works at any height. The ScrollView + input bar
    /// naturally adapt: at minimized height only the tail of the conversation
    /// is visible; at expanded height the full message list is scrollable.
    /// No view-swapping between states — just a height change — so the drag
    /// resize gesture works smoothly without structural jumps.
    private func chatPanel(containerHeight: CGFloat) -> some View {
        VStack(spacing: 0) {
            // Chevron toggle — only shown after recipe generation
            // (presenting or iterating). During initial chatting the
            // panel is always expanded so no toggle is needed.
            if phase == .presenting || phase == .iterating {
                HStack {
                    Spacer()
                    Button {
                        toggleChatPanel()
                    } label: {
                        Image(systemName: isChatMinimized
                              ? "chevron.up.circle.fill"
                              : "chevron.down.circle.fill")
                            .font(.title3)
                            .foregroundStyle(Color(red: 0.3, green: 0.3, blue: 0.35).opacity(0.6))
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 16)
                .padding(.top, 6)
                .padding(.bottom, 2)
            } else {
                Spacer().frame(height: 12)
            }

            if isChatMinimized {
                // Minimized: last assistant bubble + input bar, kept snug
                VStack(alignment: .leading, spacing: 6) {
                    if let lastAssistantMessage {
                        ChatBubble(message: lastAssistantMessage)
                            .padding(.horizontal, AlchemySpacing.screenHorizontal)
                    }

                    chatInputBar
                        .padding(.bottom, 12)
                }
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: AlchemySpacing.sm) {
                            ForEach(messages) { message in
                                ChatBubble(message: message)
                                    .id(message.id)
                            }
                        }
                        .padding(.horizontal, AlchemySpacing.screenHorizontal)
                        .padding(.top, AlchemySpacing.sm)
                        .padding(.bottom, AlchemySpacing.xxl)
                    }
                    .scrollDismissesKeyboard(.interactively)
                    .onTapGesture {
                        inputFocused = false
                    }
                    .onAppear { scrollToBottom(proxy: proxy) }
                    .onChange(of: messages.count) { scrollToBottom(proxy: proxy) }
                    .onChange(of: messages.last?.isLoading) { scrollToBottom(proxy: proxy) }
                    .onChange(of: keyboardHeight) { scrollToBottom(proxy: proxy) }
                    .onChange(of: phase) { _, newPhase in
                        if newPhase == .presenting {
                            scrollToBottom(proxy: proxy)
                        }
                    }
                }

                suggestionChips
                    .padding(.top, AlchemySpacing.sm)

                chatInputBar
                    .padding(.top, AlchemySpacing.xs)
                    .padding(.bottom, 8)
            }
        }
    }

    private var chatGradientBackground: some View {
        MeshGradient(
            width: 3,
            height: 3,
            points: [
                SIMD2(0.0, 0.0), SIMD2(0.5, 0.0), SIMD2(1.0, 0.0),
                SIMD2(0.0, 0.5), SIMD2(0.6, 0.45), SIMD2(1.0, 0.5),
                SIMD2(0.0, 1.0), SIMD2(0.5, 1.0), SIMD2(1.0, 1.0),
            ],
            colors: [
                Color(red: 0.88, green: 0.85, blue: 0.95),
                Color(red: 0.82, green: 0.92, blue: 0.96),
                Color(red: 0.90, green: 0.88, blue: 0.96),
                Color(red: 0.85, green: 0.94, blue: 0.90),
                Color(red: 0.95, green: 0.86, blue: 0.90),
                Color(red: 0.84, green: 0.90, blue: 0.97),
                Color(red: 0.92, green: 0.88, blue: 0.94),
                Color(red: 0.86, green: 0.95, blue: 0.94),
                Color(red: 0.90, green: 0.86, blue: 0.93),
            ],
            smoothsColors: true
        )
        .opacity(0.95)
    }

    /// Tappable suggestion chips shown above the input bar when the LLM
    /// provides suggested next actions.
    @ViewBuilder
    private var suggestionChips: some View {
        if !iterationSuggestions.isEmpty && !isSending {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: AlchemySpacing.sm) {
                    ForEach(Array(iterationSuggestions.enumerated()), id: \.offset) { _, suggestion in
                        Button {
                            sendMessage(prefilledText: suggestion)
                        } label: {
                            Text(suggestion)
                                .font(AlchemyTypography.caption)
                                .foregroundStyle(Color(red: 0.2, green: 0.2, blue: 0.25))
                                .padding(.horizontal, 14)
                                .padding(.vertical, 10)
                                .background {
                                    ZStack {
                                        Capsule(style: .continuous)
                                            .fill(.white.opacity(0.3))
                                            .blur(radius: 8)
                                        Capsule(style: .continuous)
                                            .fill(.white.opacity(0.2))
                                            .overlay(
                                                Capsule(style: .continuous)
                                                    .fill(.ultraThinMaterial.opacity(0.5))
                                            )
                                        Capsule(style: .continuous)
                                            .strokeBorder(.white.opacity(0.45), lineWidth: 0.5)
                                    }
                                }
                        }
                    }
                }
                .padding(.horizontal, AlchemySpacing.screenHorizontal)
            }
            .padding(.bottom, AlchemySpacing.xs)
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }

    private var chatInputBar: some View {
        HStack(spacing: AlchemySpacing.sm) {
            TextField(
                "",
                text: $inputText,
                prompt: Text(dynamicPlaceholder)
                    .foregroundStyle(Color(red: 0.35, green: 0.35, blue: 0.40)),
                axis: .vertical
            )
            .lineLimit(1...3)
            .submitLabel(.return)
            .font(AlchemyTypography.chatPlaceholder)
            .foregroundStyle(Color(red: 0.15, green: 0.15, blue: 0.18))
            .tint(Color(red: 0.2, green: 0.2, blue: 0.25))
            .focused($inputFocused)
            .fixedSize(horizontal: false, vertical: true)

            Button {
                sendMessage()
            } label: {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.title2)
                    .foregroundStyle(
                        inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSending
                            ? Color(red: 0.3, green: 0.3, blue: 0.35).opacity(0.4)
                            : Color(red: 0.3, green: 0.3, blue: 0.35)
                    )
            }
            .disabled(inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSending)
        }
        .submitScope()
        .padding(.horizontal, AlchemySpacing.lg)
        .padding(.vertical, AlchemySpacing.md)
        .background {
            ZStack {
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .fill(.white.opacity(0.35))
                    .blur(radius: 16)
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .fill(.white.opacity(0.25))
                    .overlay(
                        RoundedRectangle(cornerRadius: 24, style: .continuous)
                            .fill(.ultraThinMaterial.opacity(0.5))
                    )
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .strokeBorder(.white.opacity(0.4), lineWidth: 0.5)
            }
        }
        .padding(.horizontal, AlchemySpacing.screenHorizontal)
        .animation(.easeInOut(duration: 0.2), value: inputText)
        // Rotate placeholder prompts every 3s before the user's first message.
        // Timer fires continuously but the index update is gated on !chatHasStarted.
        .onReceive(
            Timer.publish(every: 3.0, on: .main, in: .common).autoconnect()
        ) { _ in
            guard !chatHasStarted, inputText.isEmpty else { return }
            withAnimation(.easeInOut(duration: 0.3)) {
                placeholderIndex = (placeholderIndex + 1) % Self.placeholderPrompts.count
            }
        }
    }

    /// Rotating example prompts shown in the input field before the user
    /// sends their first message. Designed to spark ideas and demonstrate
    /// the range of things the sous chef can help with.
    private static let placeholderPrompts = [
        "Give me dinner ideas",
        "Something quick with chicken thighs",
        "Impress my in-laws tonight",
        "Cozy rainy day soup",
        "Use up the spinach in my fridge",
        "Date night Italian",
        "30-minute weeknight meals",
        "Teach me to make fresh pasta",
        "Healthy meal prep for the week",
        "I have salmon and lemons",
        "Something my picky kids will eat",
        "Thai-inspired but not too spicy",
        "Weekend brunch for a crowd",
        "What goes well with risotto?",
        "A showstopper dessert",
        "Simple one-pot wonder",
    ]

    private var dynamicPlaceholder: String {
        if phase == .presenting {
            return "Want to make any changes?"
        }
        if phase == .iterating {
            return "Tell me what to change..."
        }
        if chatHasStarted {
            return "Tell your sous chef..."
        }
        return Self.placeholderPrompts[placeholderIndex % Self.placeholderPrompts.count]
    }

    // MARK: - Generation Loader

    private var generationLoader: some View {
        VStack {
            Spacer()

            LottieView(animation: .named("alchemy-loading"))
                .playing(loopMode: .loop)
                .frame(width: 160, height: 160)

            GenerationPhraseView()
                .padding(.top, AlchemySpacing.md)

            Spacer()
        }
    }

    // MARK: - Toolbar

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            HStack(spacing: AlchemySpacing.md) {
                Button {
                    selectedTab = .cookbook
                } label: {
                    Image(systemName: "chevron.left")
                        .foregroundStyle(AlchemyColors.textPrimary)
                }

                if showAddToCookbook {
                    Button {
                        guard !isCommitting else { return }
                        isCommitting = true
                        commitToCookbook()
                    } label: {
                        Text(hasMultipleComponents ? "Save All" : "Save")
                            .font(AlchemyTypography.captionBold)
                            .foregroundStyle(AlchemyColors.accent)
                    }
                    .disabled(isCommitting)
                    .transition(.scale.combined(with: .opacity))
                }

                if chatHasStarted {
                    Button {
                        startOver()
                    } label: {
                        Text("Start Over")
                            .font(AlchemyTypography.captionBold)
                            .foregroundStyle(AlchemyColors.textSecondary)
                    }
                    .transition(.scale.combined(with: .opacity))
                }
            }
        }

        ToolbarItem(placement: .topBarTrailing) {
            ImportMenu()
        }

        ToolbarItem(placement: .topBarTrailing) {
            ProfileMenu(
                onPreferences: { showPreferences = true },
                onSettings: { showSettings = true }
            )
        }
    }

    // MARK: - Scroll

    private func scrollToBottom(proxy: ScrollViewProxy) {
        guard let last = messages.last else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
            withAnimation {
                proxy.scrollTo(last.id, anchor: .bottom)
            }
        }
    }

    // MARK: - Import Session Handoff

    /// Hydrates the Generate view from a pre-seeded imported ChatSession.
    private func consumeImportedSession(_ session: ChatSessionResponse) {
        chatSessionId = session.id
        loopState = session.loopState
        candidateSet = session.candidateRecipeSet

        messages = session.messages.map { msg in
            ChatMessage(
                id: msg.id,
                role: msg.role == "assistant" ? .assistant : .user,
                content: msg.content,
                createdAt: .now,
                isLoading: false
            )
        }

        if session.candidateRecipeSet != nil {
            withAnimation(.easeInOut(duration: 0.4)) {
                phase = .presenting
                isChatPanelExpanded = false
                showAddToCookbook = true
            }
            refreshImagePolling()
        }

        if let suggestions = session.assistantReply?.suggestedNextActions,
           !suggestions.isEmpty {
            applySuggestedActions(suggestions)
        } else {
            applySuggestedActions(nil)
        }

        chatHasStarted = true
    }

    // MARK: - API Integration

    /// Fetches a personalized greeting from GET /chat/greeting.
    private func loadGreeting(focusAfter: Bool = true) async {
        // If another flow has already hydrated the screen (for example import
        // handoff), never overwrite that state with the default greeting.
        guard chatSessionId == nil, candidateSet == nil, messages.isEmpty else { return }

        let loadingId = "greeting-loading"

        withAnimation {
            messages = [ChatMessage(
                id: loadingId,
                role: .assistant,
                content: "",
                createdAt: .now,
                isLoading: true
            )]
        }

        let greetingText: String
        do {
            let greeting: ChatGreetingResponse = try await APIClient.shared.request("/chat/greeting")
            greetingText = greeting.text
        } catch {
            greetingText = "Hey Chef, what are we making today?"
        }

        withAnimation {
            if let idx = messages.firstIndex(where: { $0.id == loadingId }) {
                messages[idx] = ChatMessage(
                    id: UUID().uuidString,
                    role: .assistant,
                    content: greetingText,
                    createdAt: .now
                )
            }
        }

        if focusAfter {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                inputFocused = true
            }
        }
    }

    /// Sends a message via the chat API.
    private func sendMessage(prefilledText: String? = nil) {
        let text = (prefilledText ?? inputText)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isSending else { return }

        let userMsg = ChatMessage(
            id: UUID().uuidString,
            role: .user,
            content: text,
            createdAt: .now
        )
        messages.append(userMsg)
        isSending = true
        withAnimation { iterationSuggestions = [] }

        inputText = ""

        if !chatHasStarted {
            withAnimation { chatHasStarted = true }
        }

        let loadingId = UUID().uuidString
        let loadingMsg = ChatMessage(
            id: loadingId,
            role: .assistant,
            content: "",
            createdAt: .now,
            isLoading: true
        )
        withAnimation { messages.append(loadingMsg) }

        Task {
            defer { isSending = false }

            do {
                let response: ChatSessionResponse

                if let sessionId = chatSessionId {
                    response = try await APIClient.shared.request(
                        "/chat/\(sessionId)/messages",
                        method: .post,
                        body: ChatMessageRequest(message: text)
                    )
                } else {
                    response = try await APIClient.shared.request(
                        "/chat",
                        method: .post,
                        body: ChatMessageRequest(message: text)
                    )
                    chatSessionId = response.id
                }

                handleChatResponse(response, loadingId: loadingId)

            } catch {
                let userFacingMessage = Self.describeError(error)
                withAnimation {
                    if let idx = messages.firstIndex(where: { $0.id == loadingId }) {
                        messages[idx] = ChatMessage(
                            id: loadingId,
                            role: .assistant,
                            content: userFacingMessage,
                            createdAt: .now
                        )
                    }
                }
                print("[GenerateView] sendMessage error: \(error)")
            }
        }
    }

    /// Processes the chat API response, updating the UI state machine.
    private func handleChatResponse(_ response: ChatSessionResponse, loadingId: String) {
        let replyText = response.assistantReply?.text ?? ""
        if !replyText.isEmpty {
            withAnimation {
                if let idx = messages.firstIndex(where: { $0.id == loadingId }) {
                    messages[idx] = ChatMessage(
                        id: loadingId,
                        role: .assistant,
                        content: replyText,
                        createdAt: .now
                    )
                }
            }
        } else {
            withAnimation {
                messages.removeAll { $0.id == loadingId }
            }
        }

        // Surface preference changes as both an inline system message
        // and a floating toast that's visible even when scrolled away.
        if let updates = response.responseContext?.preferenceUpdates, !updates.isEmpty {
            let summary = updates.count == 1
                ? "Saved: \(updates[0].displayName)"
                : "\(updates.count) preferences saved"
            let systemMsg = ChatMessage(
                id: UUID().uuidString,
                role: .system,
                content: summary,
                createdAt: .now
            )
            withAnimation { messages.append(systemMsg) }

            withAnimation(.spring(duration: 0.35)) {
                savedToastText = summary
            }
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(2.5))
                withAnimation(.easeOut(duration: 0.3)) {
                    savedToastText = nil
                }
            }
        }

        applySuggestedActions(response.assistantReply?.suggestedNextActions)

        // Two-phase generation: the server deferred the heavy recipe
        // generation LLM call and returned the ideation reply fast.
        // Flip to the Lottie screen immediately and call /generate.
        if response.uiHints?.generationPending == true,
           let sessionId = chatSessionId {
            inputFocused = false
            withAnimation { phase = .generating }
            triggerDeferredGeneration(chatId: sessionId)
            return
        }

        // Recipe arrived (either inline or from the /generate call).
        if response.candidateRecipeSet != nil {
            inputFocused = false
            withAnimation(.spring(duration: 0.5, bounce: 0.15)) {
                phase = .presenting
                isChatPanelExpanded = false
                showAddToCookbook = true
            }
        }
        applyChatSessionState(response)
    }

    /// Calls POST /chat/:id/generate to run the deferred recipe generation.
    /// The Lottie animation plays for the full duration of this request.
    private func triggerDeferredGeneration(chatId: String) {
        Task { @MainActor in
            do {
                let response: ChatSessionResponse = try await APIClient.shared.request(
                    "/chat/\(chatId)/generate",
                    method: .post
                )
                handleGenerationResponse(response)
            } catch {
                print("[GenerateView] deferred generation error: \(error)")
                withAnimation {
                    phase = .chatting
                    let errorMsg = ChatMessage(
                        id: UUID().uuidString,
                        role: .assistant,
                        content: "Something went wrong generating your recipe. Try again!",
                        createdAt: .now
                    )
                    messages.append(errorMsg)
                }
            }
        }
    }

    /// Processes the response from the deferred /generate call.
    /// At this point the Lottie has been showing, so we transition
    /// straight to presenting the recipe.
    private func handleGenerationResponse(_ response: ChatSessionResponse) {
        if response.candidateRecipeSet != nil {
            withAnimation(.spring(duration: 0.5, bounce: 0.15)) {
                phase = .presenting
                isChatPanelExpanded = false
                showAddToCookbook = true
            }
        } else {
            // Generation didn't produce a recipe — fall back to chat.
            withAnimation { phase = .chatting }
            if let replyText = response.assistantReply?.text, !replyText.isEmpty {
                let msg = ChatMessage(
                    id: UUID().uuidString,
                    role: .assistant,
                    content: replyText,
                    createdAt: .now
                )
                withAnimation { messages.append(msg) }
            }
        }
        applySuggestedActions(response.assistantReply?.suggestedNextActions)
        applyChatSessionState(response)
    }

    /// Normalizes LLM-provided suggestion chips: strips filler lead-ins
    /// ("Make me a…") and redundant trailing words ("recipe", "idea") so
    /// chips read as concise noun phrases the user would naturally say.
    /// Deduplicates and drops blanks.
    private func applySuggestedActions(_ actions: [String]?) {
        let fillerPrefixes = [
            "make me a ", "make me an ", "make me ",
            "give me a ", "give me an ", "give me ",
            "how about a ", "how about an ", "how about ",
            "try a ", "try an ", "try ",
            "let's make a ", "let's make an ", "let's make ",
            "let's try a ", "let's try an ", "let's try ",
            "i want a ", "i want an ", "i want ",
            "i'd like a ", "i'd like an ", "i'd like ",
            "suggest a ", "suggest an ", "suggest ",
            "show me a ", "show me an ", "show me ",
        ]

        let fillerSuffixes = [
            " recipe idea", " recipe option", " recipe suggestion",
            " recipe", " idea", " suggestion", " option", " dish", " meal",
        ]

        var seen = Set<String>()
        let normalized = (actions ?? []).compactMap { rawAction -> String? in
            var trimmed = rawAction.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return nil }

            var lower = trimmed.lowercased()
            for prefix in fillerPrefixes {
                if lower.hasPrefix(prefix) {
                    trimmed = String(trimmed.dropFirst(prefix.count))
                    if let first = trimmed.first {
                        trimmed = first.uppercased() + trimmed.dropFirst()
                    }
                    lower = trimmed.lowercased()
                    break
                }
            }

            for suffix in fillerSuffixes {
                if lower.hasSuffix(suffix) {
                    trimmed = String(trimmed.dropLast(suffix.count))
                    break
                }
            }

            let identity = trimmed.folding(
                options: [.caseInsensitive, .diacriticInsensitive],
                locale: .current
            )
            guard !trimmed.isEmpty, seen.insert(identity).inserted else { return nil }
            return trimmed
        }

        iterationSuggestions = normalized
        suggestedPlaceholder = normalized.first
    }

    private func applyChatSessionState(_ response: ChatSessionResponse) {
        loopState = response.loopState
        candidateSet = response.candidateRecipeSet

        if let activeId = response.candidateRecipeSet?.activeComponentId,
           let idx = response.candidateRecipeSet?.components.firstIndex(where: { $0.componentId == activeId }) {
            activeComponentIndex = idx
        } else {
            activeComponentIndex = 0
        }

        refreshImagePolling()
    }

    private func refreshImagePolling() {
        imagePollingTask?.cancel()

        guard let sessionId = chatSessionId,
              let candidateSet,
              candidateSet.components.contains(where: {
                  let status = $0.imageStatus.lowercased()
                  return status == "pending" || status == "processing"
              }) else {
            return
        }

        imagePollingTask = Task {
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled else { return }

            do {
                let response: ChatSessionResponse = try await APIClient.shared.request("/chat/\(sessionId)")
                await MainActor.run {
                    guard chatSessionId == sessionId else { return }
                    applyChatSessionState(response)
                }
            } catch {
                print("[GenerateView] image poll error: \(error)")
            }
        }
    }

    private func setActiveComponent(_ componentId: String) async {
        guard let sessionId = chatSessionId else { return }
        do {
            let _: ChatSessionResponse = try await APIClient.shared.request(
                "/chat/\(sessionId)/candidate",
                method: .patch,
                body: PatchCandidateRequest(action: "set_active_component", componentId: componentId)
            )
        } catch {
            print("[GenerateView] setActiveComponent error: \(error)")
        }
    }

    /// Removes a non-main component (side, appetizer, etc.) from the
    /// candidate set via PATCH /chat/{id}/candidate. The backend refuses
    /// to delete the last remaining component.
    private func deleteComponent(_ componentId: String) async {
        guard let sessionId = chatSessionId else { return }
        do {
            let response: ChatSessionResponse = try await APIClient.shared.request(
                "/chat/\(sessionId)/candidate",
                method: .patch,
                body: PatchCandidateRequest(action: "delete_component", componentId: componentId)
            )
            withAnimation(.easeInOut(duration: 0.3)) {
                applyChatSessionState(response)
            }
        } catch {
            print("[GenerateView] deleteComponent error: \(error)")
        }
    }

    /// Commits all candidate components to the cookbook.
    /// Navigates to Cookbook immediately and shows a skeleton card there
    /// while the commit API runs in the background.
    private func commitToCookbook() {
        guard let sessionId = chatSessionId else {
            isCommitting = false
            return
        }

        let title = activeComponent?.title ?? "Saving..."
        let imageUrl = activeComponent?.imageUrl

        pendingSave = PendingSave(title: title, imageUrl: imageUrl)
        selectedTab = .cookbook

        Task {
            defer { pendingSave = nil }
            do {
                let _: ChatCommitResponse = try await APIClient.shared.request(
                    "/chat/\(sessionId)/commit",
                    method: .post
                )
            } catch {
                print("[GenerateView] commit error: \(error)")
            }
        }

        startOver()
    }

    private static func describeError(_ error: Error) -> String {
        if let apiError = error as? APIError {
            return apiError.message
        }
        if let networkError = error as? NetworkError {
            return networkError.localizedDescription
        }
        if (error as NSError).domain == NSURLErrorDomain {
            return "Network connection failed. Please check your internet and try again."
        }
        return "Something went wrong. Tap send to try again."
    }

    /// Resets all state for a fresh conversation.
    /// Focus is set via loadGreeting(focusAfter: true) rather than
    /// inline, because the withAnimation block rebuilds the view tree
    /// and any inline focus assignment gets lost.
    private func startOver() {
        imagePollingTask?.cancel()
        withAnimation {
            phase = .chatting
            messages = []
            inputText = ""
            suggestedPlaceholder = nil
            iterationSuggestions = []
            showAddToCookbook = false
            isCommitting = false
            chatHasStarted = false
            activeComponentIndex = 0
            chatSessionId = nil
            loopState = .ideation
            candidateSet = nil
            savedToastText = nil
        }
        Task { await loadGreeting(focusAfter: true) }
    }
}

// MARK: - Generation Phrase Rotator

/// Cycling cooking/baking phrases shown during recipe generation.
/// Picks a random starting point and rotates every 2 seconds with
/// a crossfade so the loading screen feels alive and playful.
struct GenerationPhraseView: View {
    private static let phrases = [
        // Prep
        "Preheating the oven...",
        "Sharpening the knife...",
        "Laying out the mise en place...",
        "Tying the apron...",
        "Clearing the counter...",
        "Pulling out the cutting board...",
        "Reading the recipe twice...",
        "Gathering the ingredients...",
        "Washing the produce...",

        // Measuring & mixing
        "Adding a pinch of salt...",
        "Measuring the flour...",
        "Cracking the eggs...",
        "A dash of this...",
        "A splash of that...",
        "Whisking until smooth...",
        "Sifting the dry ingredients...",
        "Folding in gently...",
        "Combining wet and dry...",
        "Eyeballing the measurements...",
        "One more pinch...",
        "A generous pour...",
        "Scraping down the bowl...",

        // Knife work
        "Chopping the onions...",
        "Mincing the garlic...",
        "Dicing the vegetables...",
        "Slicing it thin...",
        "Julienning the carrots...",
        "Chiffonading the basil...",
        "Brunoise-ing like a pro...",
        "Paper-thin slices...",
        "Rough chopping the herbs...",
        "Peeling the ginger...",

        // Citrus & zest
        "Zesting the lemon...",
        "Squeezing the lime...",
        "Segmenting the orange...",
        "A hit of citrus...",

        // Heat & cook
        "Simmering the broth...",
        "Browning the butter...",
        "Deglazing the pan...",
        "Caramelizing the onions...",
        "Reducing the sauce...",
        "Bringing to a boil...",
        "Turning down the heat...",
        "Adjusting the heat...",
        "Searing until golden...",
        "Getting a good crust...",
        "Low and slow...",
        "Cranking up the heat...",
        "Waiting for the sizzle...",
        "Rendering the fat...",
        "Sweating the aromatics...",
        "Building the fond...",
        "Listening for the pop...",
        "Getting the pan screaming hot...",

        // Baking & dough
        "Rolling out the dough...",
        "Kneading the dough...",
        "Scoring the bread...",
        "Proofing the yeast...",
        "Dusting with flour...",
        "Crimping the edges...",
        "Checking the rise...",
        "Buttering the pan...",
        "Lining with parchment...",

        // Spices & seasoning
        "Toasting the spices...",
        "Crushing the peppercorns...",
        "Blooming the saffron...",
        "Grinding fresh pepper...",
        "A bay leaf for luck...",
        "Cracking the cardamom...",
        "Toasting the cumin seeds...",
        "Smashing the lemongrass...",
        "Fresh crack of black pepper...",

        // Techniques
        "Flambéing carefully...",
        "Blanching the greens...",
        "Tempering the chocolate...",
        "Basting the roast...",
        "Infusing the cream...",
        "Emulsifying the dressing...",
        "Mounting with butter...",
        "Shocking in ice water...",
        "Straining through a sieve...",
        "Skimming the surface...",
        "Double-boiler situation...",
        "Braising low and slow...",
        "Poaching gently...",
        "Charring the peppers...",
        "Smoking the paprika...",
        "Dry-brining overnight...",
        "Marinating overnight... jk...",
        "Resting under foil...",

        // Dairy & cheese
        "Grating the cheese...",
        "Drizzling the oil...",
        "Crumbling the feta...",
        "Shaving the parmesan...",
        "Whipping the cream...",
        "Tempering the eggs...",

        // Tasting & adjusting
        "Tasting for seasoning...",
        "Needs more salt...",
        "Actually, perfect...",
        "One more taste...",
        "Balancing the acid...",
        "A touch more butter...",
        "Adjusting the sweetness...",
        "Nailing the texture...",
        "Almost there...",
        "Just a little more...",
        "Checking the timer...",
        "Stirring constantly...",

        // Finishing
        "Picking the perfect herb...",
        "Fresh herbs on top...",
        "Plating up...",
        "Finishing touch...",
        "A drizzle of good olive oil...",
        "Flaky salt to finish...",
        "Microplaning the garlic...",
        "Edible flowers, why not...",
        "Wiping the rim clean...",
        "Garnishing with care...",
        "A squeeze of lemon...",
        "Torching the meringue...",
        "Dusting with powdered sugar...",
        "Cracking the brûlée...",

        // Vibes
        "Letting it rest...",
        "Patience is a virtue...",
        "Good things take time...",
        "Trust the process...",
        "Worth the wait...",
        "Smells incredible...",
        "The kitchen smells amazing...",
        "Neighbors are jealous...",
        "Chef's kiss...",
        "Cooking with love...",
        "Secret ingredient: patience...",
        "No shortcuts...",
        "Respecting the craft...",
        "Channeling my nonna...",
        "What would Julia do...",
        "Mise en place is life...",
    ]

    @State private var index = Int.random(in: 0..<phrases.count)
    private let timer = Timer.publish(every: 2.0, on: .main, in: .common).autoconnect()

    var body: some View {
        Text(Self.phrases[index % Self.phrases.count])
            .font(AlchemyTypography.bodySecondary)
            .foregroundStyle(AlchemyColors.textSecondary)
            .contentTransition(.opacity)
            .animation(.easeInOut(duration: 0.4), value: index)
            .onReceive(timer) { _ in
                index = (index + 1) % Self.phrases.count
            }
    }
}

/// The discrete states of the generate screen.
enum GeneratePhase: Equatable {
    case chatting
    case generating
    case presenting
    case iterating
}

// MARK: - RecipePayload → RecipeDetail Conversion

extension RecipePayload {
    /// Converts a candidate RecipePayload into a RecipeDetail for display.
    func asDisplayDetail(
        title: String? = nil,
        imageUrl: String? = nil,
        imageStatus: String = "pending"
    ) -> RecipeDetail {
        RecipeDetail(
            id: "candidate-\(UUID().uuidString.prefix(8))",
            title: title ?? self.title,
            description: self.description ?? self.summary,
            summary: self.summary ?? self.description ?? self.title,
            servings: self.servings ?? 4,
            ingredients: self.ingredients ?? [],
            steps: self.steps ?? [],
            ingredientGroups: self.ingredientGroups
                ?? IngredientGrouping.groups(
                    for: self.ingredients ?? [],
                    preference: IngredientGroupingMode.defaultMode.rawValue
                ),
            notes: self.notes,
            pairings: self.pairings ?? [],
            metadata: self.metadata,
            emoji: self.emoji ?? [],
            imageUrl: imageUrl,
            imageStatus: imageStatus,
            visibility: "private",
            updatedAt: ISO8601DateFormatter().string(from: .now),
            version: RecipeVersionInfo(
                versionId: "candidate",
                recipeId: "candidate",
                parentVersionId: nil,
                diffSummary: nil,
                createdAt: ISO8601DateFormatter().string(from: .now)
            ),
            attachments: []
        )
    }
}
