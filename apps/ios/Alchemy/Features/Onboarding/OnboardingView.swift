import SwiftUI

/// Chat-based onboarding interview where the assistant learns user preferences.
///
/// This mirrors the Generate screen's chat UI but is focused on preference discovery.
/// The assistant asks about dietary preferences, skill level, equipment, cuisines,
/// and aversions through a conversational flow.
///
/// Stub implementation: starts with a canned greeting, lets the user type responses,
/// and simulates assistant replies. Progress bar at top tracks interview completion.
/// When wired to the API, each message goes to POST /onboarding/chat.
struct OnboardingView: View {
    @Binding var hasCompletedOnboarding: Bool

    @State private var messages: [ChatMessage] = PreviewData.onboardingMessages
    @State private var inputText = ""
    @State private var progress: Double = 0.15

    /// Simulated assistant responses for the stub.
    /// Each user message advances progress and triggers the next question.
    private let questionSequence = [
        "Great! Now tell me about your cooking skill level — are you a beginner, comfortable home cook, or experienced chef?",
        "Perfect. What kitchen equipment do you have? Things like an oven, stand mixer, sous vide, grill, etc.",
        "Nice setup! What cuisines do you love most? Italian, Japanese, Mexican, Indian — anything goes.",
        "Almost done! Are there any ingredients you dislike or are allergic to?",
        "You're all set! I've got a great picture of your tastes. Let's start cooking!",
    ]

    var body: some View {
        VStack(spacing: 0) {
            // Progress bar
            VStack(spacing: AlchemySpacing.sm) {
                HStack {
                    Text("Getting to know you")
                        .font(AlchemyTypography.subheading)
                        .foregroundStyle(AlchemyColors.textPrimary)

                    Spacer()

                    Button("Skip") {
                        hasCompletedOnboarding = true
                    }
                    .font(AlchemyTypography.bodySecondary)
                    .foregroundStyle(AlchemyColors.textSecondary)
                }

                ProgressView(value: progress)
                    .tint(AlchemyColors.accent)
            }
            .padding(.horizontal, AlchemySpacing.screenHorizontal)
            .padding(.vertical, AlchemySpacing.md)

            // Chat messages
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: AlchemySpacing.sm) {
                        ForEach(messages) { message in
                            ChatBubble(message: message)
                                .id(message.id)
                        }
                    }
                    .padding(.horizontal, AlchemySpacing.screenHorizontal)
                    .padding(.vertical, AlchemySpacing.md)
                }
                .onChange(of: messages.count) {
                    if let last = messages.last {
                        withAnimation {
                            proxy.scrollTo(last.id, anchor: .bottom)
                        }
                    }
                }
            }

            // Input bar
            GlassInputBar(
                placeholder: "Tell me about yourself...",
                text: $inputText,
                onSubmit: sendMessage
            )
            .padding(.bottom, AlchemySpacing.sm)
        }
        .background(AlchemyColors.background)
    }

    private func sendMessage() {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        // Add user message
        let userMsg = ChatMessage(
            id: UUID().uuidString,
            role: .user,
            content: text,
            createdAt: .now
        )
        messages.append(userMsg)
        inputText = ""

        // Determine which question to ask next based on progress
        let questionIndex = Int(progress / 0.2)
        let progressStep = 0.2

        // Simulate assistant response after a short delay
        if questionIndex < questionSequence.count {
            Task {
                try? await Task.sleep(for: .seconds(1))
                let reply = ChatMessage(
                    id: UUID().uuidString,
                    role: .assistant,
                    content: questionSequence[questionIndex],
                    createdAt: .now
                )
                messages.append(reply)

                withAnimation {
                    progress = min(progress + progressStep, 1.0)
                }

                // Auto-complete after the last question
                if progress >= 1.0 {
                    try? await Task.sleep(for: .seconds(1.5))
                    hasCompletedOnboarding = true
                }
            }
        }
    }
}
