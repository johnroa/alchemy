import SwiftUI

struct ChatMessage: Identifiable {
    let id: String
    let role: String
    let content: String
}

@Observable
final class OnboardingViewModel {
    var messages: [ChatMessage] = []
    var input = ""
    var progress: Double = 0
    var isLoading = false
    var fatalError: String?
    var isCompleted = false

    private var transcript: [OnboardingChatMessage] = []
    private var onboardingState: [String: JSONValue] = [:]
    private var hasInitialized = false

    func startIfNeeded(api: APIClient) async {
        guard !hasInitialized else { return }
        hasInitialized = true
        await sendMessage("", api: api, initialState: ["stage": .string("start")])
    }

    func submit(api: APIClient) async {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        let userMessage = ChatMessage(id: "user-\(Date.now.timeIntervalSince1970)", role: "user", content: text)
        messages.append(userMessage)
        transcript.append(OnboardingChatMessage(role: "user", content: text))
        input = ""

        await sendMessage(text, api: api, initialState: nil)
    }

    func skipOnboarding(api: APIClient) async {
        let skipText = "I want to skip onboarding for now and start using the app."
        let userMessage = ChatMessage(id: "user-skip", role: "user", content: skipText)
        messages.append(userMessage)
        transcript.append(OnboardingChatMessage(role: "user", content: skipText))

        await sendMessage(skipText, api: api, initialState: nil)
    }

    func retry(api: APIClient) async {
        messages.removeAll()
        transcript.removeAll()
        onboardingState = [:]
        hasInitialized = false
        await startIfNeeded(api: api)
    }

    private func sendMessage(_ message: String, api: APIClient, initialState: [String: JSONValue]?) async {
        isLoading = true
        fatalError = nil

        do {
            let state = initialState ?? onboardingState
            let response = try await api.sendOnboardingMessage(
                message: message,
                transcript: transcript,
                state: state
            )

            let assistantMessage = ChatMessage(
                id: "assistant-\(Date.now.timeIntervalSince1970)",
                role: "assistant",
                content: response.assistantReply.text
            )
            messages.append(assistantMessage)
            transcript.append(OnboardingChatMessage(role: "assistant", content: response.assistantReply.text))

            withAnimation(.spring(response: 0.4)) {
                progress = response.onboardingState.progress
            }

            if let newState = response.onboardingState.state {
                onboardingState = newState
            }

            if response.onboardingState.completed {
                Haptics.fire(.success)
                isCompleted = true
            } else {
                Haptics.fire(.light)
            }
        } catch {
            fatalError = error.localizedDescription
        }

        isLoading = false
    }
}
