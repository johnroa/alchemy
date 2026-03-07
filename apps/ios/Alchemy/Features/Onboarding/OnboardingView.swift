import SwiftUI
import Lottie

/// Full-screen chat-based onboarding where the assistant learns user preferences.
///
/// Visually mirrors GenerateView's chat UI — same MeshGradient background,
/// same ChatBubble styles, same custom glass input bar, same keyboard
/// handling — but full-screen instead of a floating 75% panel.
///
/// The conversation is open-ended: the LLM decides how to best gather
/// information about the user's cooking experience, household, equipment,
/// dietary needs, and cuisine preferences. There is no fixed question
/// count or progress bar. The user can skip at any time.
///
/// Each message is sent to POST /onboarding/chat with the full transcript.
/// The API returns an assistant reply and onboarding state (including
/// completion status). When the API marks onboarding as completed,
/// the "Let's Cook" button appears.
struct OnboardingView: View {
    @Binding var hasCompletedOnboarding: Bool

    @State private var messages: [ChatMessage] = []
    @State private var inputText = ""
    /// When true, the API has signaled that onboarding is complete.
    @State private var isComplete = false
    /// Prevents double-sends while waiting for the API response.
    @State private var isSending = false
    /// False until the initial greeting has loaded from the API.
    /// While false, a full-screen Lottie loader is shown instead of the chat.
    @State private var greetingLoaded = false

    @FocusState private var inputFocused: Bool
    /// Actual keyboard height in points, tracked via NotificationCenter.
    /// Same decoupled keyboard strategy as GenerateView: the root ZStack
    /// ignores keyboard safe area, and this value is applied as bottom
    /// padding on the input bar so only the bar moves.
    @State private var keyboardHeight: CGFloat = 0

    /// Local transcript sent with each POST /onboarding/chat request.
    /// The API is stateless per-call; the transcript provides full context.
    @State private var transcript: [TranscriptEntry] = []

    var body: some View {
        ZStack {
            chatGradientBackground
                .ignoresSafeArea()

            if greetingLoaded {
                chatContent
            } else {
                initialLoader
            }
        }
        .background(AlchemyColors.background)
        .ignoresSafeArea(.keyboard)
        .animation(.spring(duration: 0.35), value: keyboardHeight)
        .animation(.spring(duration: 0.4), value: isComplete)
        .animation(.easeInOut(duration: 0.4), value: greetingLoaded)
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
        .task {
            await loadInitialGreeting()
        }
    }

    // MARK: - Initial Loader

    /// Full-screen Lottie loader shown while the first greeting loads.
    private var initialLoader: some View {
        VStack(spacing: AlchemySpacing.lg) {
            Spacer()

            LottieView(animation: .named("alchemy-loading"))
                .playing(loopMode: .loop)
                .frame(width: 140, height: 140)

            Text("Loading your Sous Chef...")
                .font(AlchemyTypography.bodySecondary)
                .foregroundStyle(Color(red: 0.3, green: 0.3, blue: 0.35))

            Spacer()
        }
        .transition(.opacity)
    }

    // MARK: - Chat Content

    /// The main chat UI — header, scrollable messages, and input bar.
    /// Only shown after the initial greeting has loaded.
    private var chatContent: some View {
        VStack(spacing: 0) {
            headerBar

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: AlchemySpacing.sm) {
                        ForEach(messages) { message in
                            ChatBubble(message: message)
                                .id(message.id)
                        }
                    }
                    .padding(.horizontal, AlchemySpacing.screenHorizontal)
                    .padding(.top, AlchemySpacing.xxxl)
                    .padding(.bottom, 80)
                }
                .scrollDismissesKeyboard(.interactively)
                .onTapGesture { inputFocused = false }
                .onChange(of: messages.count) {
                    scrollToBottom(proxy: proxy)
                }
                .onChange(of: messages.last?.isLoading) {
                    scrollToBottom(proxy: proxy)
                }
                .onChange(of: keyboardHeight) {
                    scrollToBottom(proxy: proxy)
                }
            }

            if isComplete {
                completionButton
                    .padding(.bottom, 40)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            } else {
                chatInputBar
                    .padding(.top, AlchemySpacing.lg)
                    .padding(.bottom, keyboardHeight > 0
                        ? keyboardHeight - 16
                        : 40)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .transition(.opacity)
    }

    // MARK: - Header

    private var headerBar: some View {
        HStack {
            Text("Getting to know you")
                .font(AlchemyTypography.subheading)
                .foregroundStyle(Color(red: 0.15, green: 0.15, blue: 0.18))

            Spacer()

            Button {
                Task { await skipOnboarding() }
            } label: {
                Text("Skip")
                    .font(AlchemyTypography.bodySecondary)
                    .foregroundStyle(Color(red: 0.35, green: 0.35, blue: 0.40))
            }
        }
        .padding(.horizontal, AlchemySpacing.screenHorizontal)
        .padding(.top, AlchemySpacing.xl)
        .padding(.bottom, AlchemySpacing.md)
        .safeAreaPadding(.top)
    }

    // MARK: - Gradient

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

    // MARK: - Input Bar

    private var chatInputBar: some View {
        HStack(spacing: AlchemySpacing.sm) {
            TextField(
                "",
                text: $inputText,
                prompt: Text("Tell me about yourself...")
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

    // MARK: - Completion Button

    private var completionButton: some View {
        Button {
            hasCompletedOnboarding = true
        } label: {
            Text("Let's Cook")
                .font(AlchemyTypography.subheading)
                .foregroundStyle(Color(red: 0.15, green: 0.15, blue: 0.18))
                .frame(maxWidth: .infinity)
                .padding(.vertical, AlchemySpacing.md)
        }
        .background {
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(.white.opacity(0.4))
                .overlay(
                    RoundedRectangle(cornerRadius: 24, style: .continuous)
                        .fill(.ultraThinMaterial.opacity(0.5))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 24, style: .continuous)
                        .strokeBorder(.white.opacity(0.5), lineWidth: 0.5)
                )
        }
        .padding(.horizontal, AlchemySpacing.screenHorizontal)
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

    /// Kicks off onboarding by fetching the assistant's opening question.
    /// While loading, the full-screen Lottie loader is shown (greetingLoaded
    /// is false). Once the greeting arrives, the chat UI crossfades in.
    private func loadInitialGreeting() async {
        let greetingText: String
        do {
            let response: OnboardingChatResponse = try await APIClient.shared.request(
                "/onboarding/chat",
                method: .post,
                body: OnboardingChatRequest(message: nil, transcript: nil)
            )
            greetingText = response.assistantReply.text
        } catch {
            greetingText = "Welcome to Alchemy! I'm your Sous Chef. Tell me a little about yourself — who are you cooking for, and how comfortable are you in the kitchen?"
            print("[OnboardingView] initial greeting failed: \(error)")
        }

        messages = [ChatMessage(
            id: UUID().uuidString,
            role: .assistant,
            content: greetingText,
            createdAt: .now
        )]

        transcript.append(TranscriptEntry(
            role: "assistant",
            content: greetingText,
            createdAt: ISO8601DateFormatter().string(from: .now)
        ))

        withAnimation {
            greetingLoaded = true
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
            inputFocused = true
        }
    }

    /// Sends the user's message to POST /onboarding/chat with the full
    /// transcript for context. Parses the response to update the chat
    /// and detect completion.
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
        Task { @MainActor in inputText = "" }

        transcript.append(TranscriptEntry(
            role: "user",
            content: text,
            createdAt: ISO8601DateFormatter().string(from: .now)
        ))

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
                let response: OnboardingChatResponse = try await APIClient.shared.request(
                    "/onboarding/chat",
                    method: .post,
                    body: OnboardingChatRequest(message: text, transcript: transcript)
                )

                let reply = ChatMessage(
                    id: loadingId,
                    role: .assistant,
                    content: response.assistantReply.text,
                    createdAt: .now
                )
                withAnimation {
                    if let idx = messages.firstIndex(where: { $0.id == loadingId }) {
                        messages[idx] = reply
                    }
                }

                transcript.append(TranscriptEntry(
                    role: "assistant",
                    content: response.assistantReply.text,
                    createdAt: ISO8601DateFormatter().string(from: .now)
                ))

                // Only show "Let's Cook" when the API marks completed AND
                // the assistant isn't asking a follow-up question. If the
                // reply ends with a question mark the conversation isn't
                // really done — let the user respond first.
                let replyEndsWithQuestion = response.assistantReply.text
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                    .hasSuffix("?")
                if response.onboardingState.completed && !replyEndsWithQuestion {
                    try? await Task.sleep(for: .seconds(0.5))
                    withAnimation {
                        isComplete = true
                        inputFocused = false
                    }
                }
            } catch {
                // Remove loading bubble on error, show inline error
                withAnimation {
                    messages.removeAll { $0.id == loadingId }
                }
                let errorMsg = ChatMessage(
                    id: UUID().uuidString,
                    role: .assistant,
                    content: "Sorry, I had trouble processing that. Could you try again?",
                    createdAt: .now
                )
                withAnimation { messages.append(errorMsg) }
                print("[OnboardingView] sendMessage error: \(error)")
            }
        }
    }

    /// Sends "skip" to the API, which detects the keyword and marks
    /// onboarding as completed server-side.
    private func skipOnboarding() async {
        do {
            let _: OnboardingChatResponse = try await APIClient.shared.request(
                "/onboarding/chat",
                method: .post,
                body: OnboardingChatRequest(message: "skip", transcript: transcript)
            )
        } catch {
            print("[OnboardingView] skip request failed: \(error)")
        }
        hasCompletedOnboarding = true
    }
}
