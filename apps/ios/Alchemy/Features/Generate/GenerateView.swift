import SwiftUI
import Lottie

/// Sous Chef screen — the core recipe creation experience.
///
/// State machine driven by the chat API's loop_state:
/// 1. `.chatting` (ideation) — Skeleton in background, chat floating over bottom 75%
/// 2. `.generating` — Chat minimizes, Lottie animation plays over skeleton
/// 3. `.presenting` (candidate_presented) — Recipe loads, "Add to Cookbook" appears
/// 4. `.iterating` — User sends tweaks, loops back through generating/presenting
///
/// API endpoints used:
///   - GET /chat/greeting — personalized opening message
///   - POST /chat — create session + first message
///   - POST /chat/{id}/messages — continue conversation
///   - PATCH /chat/{id}/candidate — switch active component
///   - POST /chat/{id}/commit — save all components to cookbook
struct GenerateView: View {
    @Binding var selectedTab: AppTab

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
    /// response. The first item becomes the placeholder text in the input
    /// bar, giving contextual hints instead of a static default.
    @State private var suggestedPlaceholder: String?
    /// All suggested actions from the latest assistant reply. Used to build
    /// the iteration briefing when "Make Changes" is tapped.
    @State private var iterationSuggestions: [String] = []

    @FocusState private var inputFocused: Bool
    @State private var keyboardHeight: CGFloat = 0

    // MARK: - API State

    /// Session ID from POST /chat. Nil until the first message is sent.
    @State private var chatSessionId: String?
    /// Current loop state from the API response.
    @State private var loopState: ChatLoopState = .ideation
    /// The candidate recipe set returned when the LLM generates a recipe.
    @State private var candidateSet: APICandidateRecipeSet?
    @State private var imagePollingTask: Task<Void, Never>?

    var body: some View {
        ZStack {
            Color.clear
                .ignoresSafeArea()
                .overlay { backgroundContent }

            NavigationStack {
                ZStack {
                    if phase == .presenting {
                        presentedRecipe
                    } else {
                        Color.clear.allowsHitTesting(false)
                    }

                    if phase == .chatting || phase == .iterating {
                        chatPanelContent
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                    }

                    if phase == .presenting {
                        VStack {
                            Spacer()
                            Button {
                                enterIterationMode()
                            } label: {
                                Text("Want to make any changes?")
                                    .font(AlchemyTypography.chatPlaceholder)
                                    .foregroundStyle(AlchemyColors.textSecondary)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.horizontal, AlchemySpacing.lg)
                                    .padding(.vertical, AlchemySpacing.md)
                            }
                            .glassEffect(.regular, in: .capsule)
                            .padding(.horizontal, AlchemySpacing.screenHorizontal)
                            .padding(.bottom, AlchemySpacing.lg)
                        }
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                    }

                    if phase == .generating {
                        generationLoader.transition(.opacity)
                    }
                }
                .containerBackground(.clear, for: .navigation)
                .toolbarBackground(.hidden, for: .navigationBar)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { toolbarContent }
                .animation(.spring(duration: 0.5, bounce: 0.2), value: phase)
                .toolbarVisibility(.hidden, for: .tabBar)
                .sheet(isPresented: $showPreferences) { PreferencesView(selectedTab: $selectedTab) }
                .sheet(isPresented: $showSettings) { SettingsView() }
            }
        }
        .background(AlchemyColors.background)
        .ignoresSafeArea(.keyboard)
        .task { await loadGreeting() }
        .onDisappear { imagePollingTask?.cancel() }
    }

    // MARK: - Background Content

    @ViewBuilder
    private var backgroundContent: some View {
        switch phase {
        case .chatting, .generating:
            recipeSkeleton
        case .iterating:
            presentedRecipe
        case .presenting:
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
    /// Converts the RecipePayload from the candidate set into a RecipeDetail
    /// for display. Lacks image/id since the recipe hasn't been committed yet.
    private var presentedRecipe: some View {
        ZStack(alignment: .top) {
            if let component = activeComponent {
                RecipeDetailView(
                    detail: component.recipe.asDisplayDetail(
                        title: component.title,
                        imageUrl: component.imageUrl,
                        imageStatus: component.imageStatus
                    ),
                    showShareButton: false,
                    showTweakBar: false,
                    isEmbedded: true
                )
                // Force view recreation when image status changes so the
                // @State detail inside RecipeDetailView picks up the new
                // imageUrl/imageStatus from polling.
                .id("\(component.componentId)-\(component.imageStatus)-\(component.imageUrl ?? "")")
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
                    Button {
                        withAnimation { activeComponentIndex = index }
                        // Tell the API which component is active
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
                }
            }
            .padding(.horizontal, AlchemySpacing.screenHorizontal)
            .padding(.vertical, AlchemySpacing.sm)
        }
    }

    // MARK: - Chat Panel Content

    private var chatPanelContent: some View {
        VStack(spacing: 0) {
            RoundedRectangle(cornerRadius: 2)
                .fill(Color.black.opacity(0.3))
                .frame(width: 36, height: 4)
                .padding(.top, AlchemySpacing.sm)
                .padding(.bottom, AlchemySpacing.xs)

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
                .onTapGesture { inputFocused = false }
                .onChange(of: messages.count) { scrollToBottom(proxy: proxy) }
                .onChange(of: messages.last?.isLoading) { scrollToBottom(proxy: proxy) }
                .onChange(of: keyboardHeight) { scrollToBottom(proxy: proxy) }
            }

            suggestionChips
                .padding(.top, AlchemySpacing.sm)

            chatInputBar
                .padding(.top, AlchemySpacing.xs)
                .padding(.bottom, keyboardHeight > 0 ? keyboardHeight - 16 : 40)
        }
        .frame(maxHeight: UIScreen.main.bounds.height * 0.75)
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
        .ignoresSafeArea(.keyboard)
        .animation(.spring(duration: 0.35), value: keyboardHeight)
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
    /// provides suggested next actions. Tapping a chip sends its text as
    /// a message immediately, removing all chips. Uses the same layered
    /// glass treatment as the chat input bar for visual consistency.
    @ViewBuilder
    private var suggestionChips: some View {
        if !iterationSuggestions.isEmpty && !isSending {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: AlchemySpacing.sm) {
                    ForEach(iterationSuggestions, id: \.self) { suggestion in
                        Button {
                            inputText = suggestion
                            sendMessage()
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
    }

    /// Contextual placeholder for the chat input. Suggestions are now
    /// shown as tappable chips above the bar, so the placeholder stays
    /// generic and phase-appropriate.
    private var dynamicPlaceholder: String {
        if phase == .iterating {
            return "Tell me what to change..."
        }
        return "Give me dinner ideas"
    }

    // MARK: - Generation Loader

    private var generationLoader: some View {
        VStack {
            Spacer()

            LottieView(animation: .named("alchemy-loading"))
                .playing(loopMode: .loop)
                .frame(width: 160, height: 160)

            Text("Crafting your recipe...")
                .font(AlchemyTypography.bodySecondary)
                .foregroundStyle(AlchemyColors.textSecondary)
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
                        Task { await commitToCookbook() }
                    } label: {
                        if isCommitting {
                            ProgressView()
                                .tint(AlchemyColors.accent)
                                .scaleEffect(0.7)
                        } else {
                            Text("Save")
                                .font(AlchemyTypography.captionBold)
                                .foregroundStyle(AlchemyColors.accent)
                        }
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

    // MARK: - API Integration

    /// Fetches a personalized greeting from GET /chat/greeting.
    /// Shows a chef loading bubble immediately so the screen is never blank,
    /// then swaps it for the real greeting once the API responds.
    /// - Parameter focusAfter: Whether to focus the input field after the
    ///   greeting loads. On Start Over the keyboard is raised immediately
    ///   so we skip the deferred focus to avoid a double-trigger.
    private func loadGreeting(focusAfter: Bool = true) async {
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
    /// First message creates a session (POST /chat), subsequent messages
    /// continue it (POST /chat/{id}/messages).
    private func sendMessage() {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isSending else { return }

        let userMsg = ChatMessage(
            id: UUID().uuidString,
            role: .user,
            content: text,
            createdAt: .now
        )
        messages.append(userMsg)
        isSending = true
        // Clear chips immediately so they disappear when the user sends
        withAnimation { iterationSuggestions = [] }

        // Deferred clear: multi-line TextField (axis: .vertical) has a known
        // SwiftUI issue where setting the binding to "" while focused doesn't
        // visually update. Deferring to the next runloop tick lets the view
        // cycle complete first, ensuring the field actually clears.
        Task { @MainActor in inputText = "" }

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
                    // Continue existing session
                    response = try await APIClient.shared.request(
                        "/chat/\(sessionId)/messages",
                        method: .post,
                        body: ChatMessageRequest(message: text)
                    )
                } else {
                    // Create new session with first message
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
                // Re-populate the input so the user can retry without retyping
                inputText = text
                print("[GenerateView] sendMessage error: \(error)")
            }
        }
    }

    /// Processes the chat API response, updating the UI state machine.
    private func handleChatResponse(_ response: ChatSessionResponse, loadingId: String) {
        // Replace loading bubble with assistant reply
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
            // No text reply — remove the loading bubble
            withAnimation {
                messages.removeAll { $0.id == loadingId }
            }
        }

        // Surface preference changes as inline system notifications.
        // The API returns preference_updates in response_context when the
        // Sous Chef saves user preferences during conversation.
        if let updates = response.responseContext?.preferenceUpdates, !updates.isEmpty {
            let fields = updates.map(\.field)
            let summary = fields.count == 1
                ? "Preference saved: \(fields[0].replacingOccurrences(of: "_", with: " "))"
                : "\(fields.count) preferences saved"
            let systemMsg = ChatMessage(
                id: UUID().uuidString,
                role: .system,
                content: summary,
                createdAt: .now
            )
            withAnimation { messages.append(systemMsg) }
        }

        // Update iteration suggestions and placeholder from the LLM response.
        // All actions are kept for the iteration briefing; the first becomes
        // the input placeholder for contextual hints.
        if let actions = response.assistantReply?.suggestedNextActions, !actions.isEmpty {
            iterationSuggestions = actions
            suggestedPlaceholder = actions[0]
        } else {
            iterationSuggestions = []
            suggestedPlaceholder = nil
        }

        // Handle generation animation
        if response.uiHints?.showGenerationAnimation == true {
            Task { @MainActor in
                inputFocused = false
                withAnimation { phase = .generating }

                // Show loader for 2 seconds before revealing the recipe
                try? await Task.sleep(for: .seconds(2))

                withAnimation(.spring(duration: 0.5)) {
                    phase = .presenting
                    showAddToCookbook = true
                }
            }
        } else if response.candidateRecipeSet != nil && phase != .presenting {
            // Recipe was updated without animation (iteration)
            withAnimation(.spring(duration: 0.5)) {
                phase = .presenting
                showAddToCookbook = true
            }
        }
        applyChatSessionState(response)
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

    /// Tells the API to switch the active component in the candidate set.
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

    /// Commits all candidate components to the cookbook.
    /// Sets `isCommitting` guard before entry so the Save button is
    /// disabled immediately. On success, switches to the Cookbook tab.
    /// On failure, re-enables the button so the user can retry.
    private func commitToCookbook() async {
        guard let sessionId = chatSessionId else {
            isCommitting = false
            return
        }
        do {
            let _: ChatCommitResponse = try await APIClient.shared.request(
                "/chat/\(sessionId)/commit",
                method: .post
            )

            // Navigate to the Cookbook tab — CookbookView reloads via .task
            selectedTab = .cookbook
        } catch {
            isCommitting = false
            print("[GenerateView] commit error: \(error)")
        }
    }

    /// Converts a caught error into a concise, user-facing message.
    /// Prioritizes API error messages when available, falls back to
    /// network error descriptions, and uses a generic fallback last.
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

    /// Transitions to iteration mode with an assistant briefing message
    /// that tells the user what they can change, using the LLM-provided
    /// suggestions that are already tailored to the recipe and preferences.
    private func enterIterationMode() {
        let briefing = buildIterationBriefing()
        withAnimation(.spring(duration: 0.4)) {
            phase = .iterating
            messages.append(ChatMessage(
                id: UUID().uuidString,
                role: .assistant,
                content: briefing,
                createdAt: .now
            ))
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            inputFocused = true
        }
    }

    /// Constructs a concise iteration briefing from the LLM's suggested
    /// next actions. Falls back to generic guidance if none are available.
    private func buildIterationBriefing() -> String {
        if iterationSuggestions.count >= 2 {
            let joined = iterationSuggestions
                .prefix(3)
                .enumerated()
                .map { index, suggestion in
                    // Lowercase the first character for mid-sentence flow
                    let clean = suggestion.prefix(1).lowercased() + suggestion.dropFirst()
                    return clean
                }
                .joined(separator: ", or ")
            return "Sure! I can \(joined) — or tell me whatever you'd like to change."
        } else if let single = iterationSuggestions.first {
            let clean = single.prefix(1).lowercased() + single.dropFirst()
            return "Sure! I can \(clean), swap ingredients, adjust servings — whatever you'd like."
        } else {
            return "Sure! I can swap ingredients, adjust portions, change the cooking method, or tweak the spice level. What would you like?"
        }
    }

    /// Resets all state for a fresh conversation.
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
        }
        // Focus keyboard immediately so user can type while greeting loads
        inputFocused = true
        Task { await loadGreeting(focusAfter: false) }
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
    /// Fills in placeholder values for fields that only exist after persistence
    /// (id, image_url, version, etc.).
    func asDisplayDetail(
        title: String? = nil,
        imageUrl: String? = nil,
        imageStatus: String = "pending"
    ) -> RecipeDetail {
        RecipeDetail(
            id: "candidate-\(UUID().uuidString.prefix(8))",
            title: title ?? self.title,
            description: self.description,
            summary: self.description ?? self.title,
            servings: self.servings ?? 4,
            ingredients: self.ingredients ?? [],
            steps: self.steps ?? [],
            ingredientGroups: nil,
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
