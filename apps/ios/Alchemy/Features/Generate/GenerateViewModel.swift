import SwiftUI

// MARK: - Mode State Machine

enum GenerateViewMode: Equatable {
    case idle
    case chatting
    case generating
    case recipe
    case tweaking
    case tweakLoading
}

// MARK: - Message

struct GenerateMessage: Identifiable {
    let id: String
    let role: String
    let content: String
    let timestamp: Date
}

// MARK: - ViewModel

@Observable
final class GenerateViewModel {
    // Chat state
    var chatId: String?
    var messages: [GenerateMessage] = []
    var activeRecipe: RecipeView?
    var assistantReply: AssistantReply?

    // UI state
    var input = ""
    var isLoading = false
    var isSaving = false
    var error: String?
    var isTweakSheetOpen = false
    var isSaved = false
    var showSavedConfirmation = false
    var isGenerationTransitioning = false
    var suggestions: [String] = []

    var hasRecipe: Bool { activeRecipe != nil }

    var lastUserMessage: String {
        messages.last(where: { $0.role == "user" })?.content ?? ""
    }

    /// `.generating` only after a back-and-forth (user picked a dish).
    /// First message stays in `.chatting` with thinking indicator.
    var mode: GenerateViewMode {
        if isLoading && hasRecipe && isTweakSheetOpen { return .tweakLoading }
        if isLoading && !hasRecipe && (isGenerationTransitioning || messages.count >= 3) { return .generating }
        if hasRecipe && isTweakSheetOpen { return .tweaking }
        if hasRecipe { return .recipe }
        if !messages.isEmpty { return .chatting }
        return .idle
    }

    // MARK: - Create Chat

    func createChat(api: APIClient) async {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        let userMessage = GenerateMessage(id: "user-\(Date.now.timeIntervalSince1970)", role: "user", content: text, timestamp: .now)
        messages.append(userMessage)
        input = ""
        isLoading = true
        error = nil
        isGenerationTransitioning = shouldStartGenerationTransition(for: text)
        let requestStartedAt = Date()

        do {
            let response = try await api.createChat(message: text)
            await ensureMinimumGeneratingState(startedAt: requestStartedAt)
            chatId = response.id
            processChatResponse(response)
            Haptics.fire(.light)
        } catch {
            self.error = error.localizedDescription
        }

        isGenerationTransitioning = false
        isLoading = false
    }

    // MARK: - Continue Chat (also used for tweaks)

    func continueChat(api: APIClient) async {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, let chatId else { return }

        let userMessage = GenerateMessage(id: "user-\(Date.now.timeIntervalSince1970)", role: "user", content: text, timestamp: .now)
        messages.append(userMessage)
        input = ""
        isLoading = true
        error = nil
        isGenerationTransitioning = shouldStartGenerationTransition(for: text)
        let requestStartedAt = Date()

        do {
            let response = try await api.sendChatMessage(chatId: chatId, message: text)
            await ensureMinimumGeneratingState(startedAt: requestStartedAt)
            processChatResponse(response)
            // Close tweak sheet after response — show updated recipe
            if hasRecipe {
                isTweakSheetOpen = false
            }
            Haptics.fire(.light)
        } catch {
            self.error = error.localizedDescription
        }

        isGenerationTransitioning = false
        isLoading = false
    }

    // MARK: - Save to Cookbook (persists the chat recipe)

    func saveToCookbook(api: APIClient) async {
        guard let chatId else { return }
        isSaving = true
        error = nil

        do {
            let response = try await api.generateFromChat(chatId: chatId)
            activeRecipe = response.recipe
            isSaved = true
            showSavedConfirmation = true
            Haptics.fire(.success)

            try? await Task.sleep(for: .seconds(2))
            showSavedConfirmation = false
        } catch {
            self.error = error.localizedDescription
        }

        isSaving = false
    }

    // MARK: - Send Message (dispatches to correct handler)

    func sendMessage(api: APIClient) async {
        if chatId != nil {
            await continueChat(api: api)
        } else {
            await createChat(api: api)
        }
    }

    // MARK: - Reset

    func reset() {
        chatId = nil
        messages.removeAll()
        activeRecipe = nil
        assistantReply = nil
        input = ""
        isLoading = false
        isSaving = false
        error = nil
        isTweakSheetOpen = false
        isSaved = false
        showSavedConfirmation = false
        isGenerationTransitioning = false
        suggestions = []
    }

    // MARK: - Private

    private func processChatResponse(_ response: ChatResponse) {
        #if DEBUG
        print("[Chat] hasRecipe: \(response.activeRecipe != nil), hasReply: \(response.assistantReply != nil)")
        #endif
        if let chatRecipe = response.activeRecipe {
            activeRecipe = chatRecipe.asRecipeView
        }

        if let reply = response.assistantReply {
            assistantReply = reply
            suggestions = reply.suggestedNextActions ?? []
            let msg = GenerateMessage(
                id: "assistant-\(Date.now.timeIntervalSince1970)",
                role: "assistant",
                content: reply.text,
                timestamp: .now
            )
            messages.append(msg)
        }
    }

    private func shouldStartGenerationTransition(for text: String) -> Bool {
        activeRecipe == nil && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func ensureMinimumGeneratingState(startedAt: Date) async {
        guard isGenerationTransitioning else { return }
        let minimumDuration: TimeInterval = 0.8
        let elapsed = Date().timeIntervalSince(startedAt)
        let remaining = minimumDuration - elapsed
        guard remaining > 0 else { return }
        try? await Task.sleep(nanoseconds: UInt64(remaining * 1_000_000_000))
    }
}
