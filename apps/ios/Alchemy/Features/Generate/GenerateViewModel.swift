import SwiftUI

enum GenerateLoopUIState: Equatable {
    case ideation
    case candidatePresented
    case iterating
}

enum GeneratePresentationMode: Equatable {
    case ideationExpanded
    case generationMinimized
    case candidatePresented
    case iterating
}

struct GenerateMessage: Identifiable {
    let id: String
    let role: String
    let content: String
    let timestamp: Date
    var isPending: Bool = false
}

@Observable
@MainActor
final class GenerateViewModel {
    private static let welcomeMessageId = "assistant-welcome"
    private static let genericWelcomeVariants = [
        "Hi Chef! What are we cooking today?"
    ]
    private static let typingDescriptors = [
        "Baking...",
        "Brewing...",
        "Sauteeing...",
        "Whisking...",
        "Simmering...",
        "Plating...",
        "Chopping...",
        "Searing...",
        "Roasting...",
        "Toasting spices...",
        "Stirring the pot...",
        "Seasoning...",
        "Reducing sauce...",
        "Marinating ideas...",
        "Preheating...",
        "Deglazing...",
        "Blending flavors...",
        "Infusing herbs...",
        "Tasting for balance...",
        "Kneading...",
        "Folding gently...",
        "Caramelizing...",
        "Smashing garlic...",
        "Zesting...",
        "Braising...",
        "Poaching...",
        "Steaming...",
        "Grilling...",
        "Skimming the broth...",
        "Balancing heat...",
        "Garnishing...",
        "Drafting steps...",
        "Measuring carefully...",
        "Timing the finish...",
        "Finishing with salt...",
        "Pairing sides...",
        "Building the menu..."
    ]

    var chatId: String?
    var chatSession: ChatSession?

    var messages: [GenerateMessage] = []
    var input = ""

    var isSendingMessage = false
    var isMutatingCandidate = false
    var isCommitting = false

    var error: String?

    var commitResult: CommitPayload?
    var showCommitOptionsSheet = false

    private var optimisticActiveComponentId: String?
    private var typingDescriptorIndex = 0
    private var lastWelcomeMessageText: String?
    private var shownGenerationAnimationKeys = Set<String>()
    private var generationAnimationTask: Task<Void, Never>?
    private var isGenerationAnimationActive = false

    init() {
        seedWelcomeMessageIfNeeded()
    }

    var loopState: ChatLoopState {
        chatSession?.loopState ?? .ideation
    }

    var isOutOfScope: Bool {
        chatSession?.responseContext?.intent == .outOfScope
    }

    var effectiveLoopState: ChatLoopState {
        isOutOfScope ? .ideation : loopState
    }

    var uiState: GenerateLoopUIState {
        switch presentationMode {
        case .ideationExpanded, .generationMinimized:
            return .ideation
        case .candidatePresented:
            return .candidatePresented
        case .iterating:
            return .iterating
        }
    }

    var presentationMode: GeneratePresentationMode {
        if isOutOfScope {
            return .ideationExpanded
        }

        if isGenerationAnimationActive {
            return .generationMinimized
        }

        guard hasCandidate else {
            return .ideationExpanded
        }

        if isSendingMessage || effectiveLoopState == .iterating {
            return .iterating
        }

        return .candidatePresented
    }

    var candidateRecipeSet: CandidateRecipeSet? {
        guard !isOutOfScope else { return nil }
        return chatSession?.candidateRecipeSet
    }

    var hasCandidate: Bool {
        guard let set = candidateRecipeSet else { return false }
        return !set.components.isEmpty
    }

    var candidateComponents: [CandidateRecipeComponent] {
        candidateRecipeSet?.components ?? []
    }

    var activeComponentId: String? {
        optimisticActiveComponentId ?? candidateRecipeSet?.activeComponentId
    }

    var activeComponent: CandidateRecipeComponent? {
        guard let set = candidateRecipeSet else { return nil }
        if let activeComponentId,
           let selected = set.components.first(where: { $0.componentId == activeComponentId }) {
            return selected
        }
        return set.components.first
    }

    var activeRecipe: RecipeView? {
        guard let activeComponent else { return nil }
        return activeComponent.recipe.asRecipeView(
            id: activeComponent.componentId,
            updatedAt: chatSession?.updatedAt ?? ""
        )
    }

    var assistantReplyText: String? {
        chatSession?.assistantReply?.text
    }

    var suggestions: [String] {
        chatSession?.assistantReply?.suggestedNextActions ?? []
    }

    var shouldShowGenerationAnimation: Bool {
        !isOutOfScope && hasCandidate && isSendingMessage && chatSession?.uiHints?.showGenerationAnimation == true
    }

    var typingDescriptor: String {
        Self.typingDescriptors[typingDescriptorIndex]
    }

    var shouldShowRecipeSkeleton: Bool {
        !isOutOfScope && !hasCandidate && isSendingMessage
    }

    var lastUserMessage: String {
        messages.last(where: { $0.role == "user" })?.content ?? ""
    }

    var welcomePromptText: String {
        messages.first(where: { $0.id == Self.welcomeMessageId })?.content ?? Self.genericWelcomeVariants[0]
    }

    func sendMessage(api: APIClient) async {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        await sendMessage(text: text, api: api)
    }

    func sendMessage(text: String, api: APIClient) async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isSendingMessage else { return }

        let pendingMessageId = appendLocalMessage(role: "user", content: trimmed, isPending: true)
        advanceTypingDescriptor()
        if input.trimmingCharacters(in: .whitespacesAndNewlines) == trimmed {
            input = ""
        }
        error = nil
        isSendingMessage = true

        do {
            let session: ChatSession
            if let chatId {
                session = try await api.sendChatMessage(chatId: chatId, message: trimmed)
            } else {
                session = try await api.createChat(message: trimmed)
            }

            applySession(session)
            Haptics.fire(.light)
        } catch {
            markMessagePending(messageId: pendingMessageId, isPending: false)
            if !handleServerError(error) {
                self.error = error.localizedDescription
            }
        }

        isSendingMessage = false
    }

    func switchActiveComponent(_ componentId: String, api: APIClient) async {
        guard hasCandidate, let chatId else { return }

        optimisticActiveComponentId = componentId
        isMutatingCandidate = true
        error = nil

        do {
            let session = try await api.patchCandidate(
                chatId: chatId,
                requestBody: .setActiveComponent(componentId)
            )
            applySession(session)
        } catch {
            await reconcileAfterCandidateMutationFailure(error: error, api: api)
        }

        isMutatingCandidate = false
        optimisticActiveComponentId = nil
    }

    func deleteComponent(_ componentId: String, api: APIClient) async {
        guard let set = candidateRecipeSet, let chatId else { return }
        guard set.components.count > 1 else {
            error = "At least one recipe tab must remain."
            return
        }

        isMutatingCandidate = true
        error = nil

        do {
            let session = try await api.patchCandidate(
                chatId: chatId,
                requestBody: .deleteComponent(componentId)
            )
            applySession(session)
        } catch {
            await reconcileAfterCandidateMutationFailure(error: error, api: api)
        }

        isMutatingCandidate = false
    }

    func clearCandidate(api: APIClient) async {
        guard chatId != nil else { return }

        isMutatingCandidate = true
        error = nil

        do {
            guard let chatId else { return }
            let session = try await api.patchCandidate(chatId: chatId, requestBody: .clearCandidate())
            applySession(session)
        } catch {
            await reconcileAfterCandidateMutationFailure(error: error, api: api)
        }

        isMutatingCandidate = false
    }

    func commitCandidate(api: APIClient) async {
        guard let chatId, hasCandidate else { return }

        isCommitting = true
        error = nil

        do {
            let response = try await api.commitChat(chatId: chatId)
            commitResult = response.commit
            applySession(response.session)
            showCommitOptionsSheet = true
            Haptics.fire(.success)
        } catch {
            if !handleServerError(error, resetCandidateOnMissing: true) {
                self.error = error.localizedDescription
            }
        }

        isCommitting = false
    }

    func continueChatAfterCommit() {
        showCommitOptionsSheet = false
    }

    func restartChatAfterCommit() {
        resetAll()
    }

    func takeCommittedRecipeIds() -> [String] {
        let ids = commitResult?.recipes.map(\.recipeId) ?? []
        showCommitOptionsSheet = false
        return ids
    }

    func resetAll() {
        generationAnimationTask?.cancel()
        generationAnimationTask = nil
        chatId = nil
        chatSession = nil
        messages = []
        input = ""
        isSendingMessage = false
        isMutatingCandidate = false
        isCommitting = false
        error = nil
        commitResult = nil
        showCommitOptionsSheet = false
        optimisticActiveComponentId = nil
        shownGenerationAnimationKeys.removeAll()
        isGenerationAnimationActive = false
        seedWelcomeMessageIfNeeded()
        typingDescriptorIndex = 0
    }

    private func applySession(_ session: ChatSession) {
        updateGenerationAnimationState(from: session)
        chatId = session.id
        chatSession = session
        optimisticActiveComponentId = nil

        mergeServerMessages(
            session.messages,
            assistantReplyFallback: session.assistantReply?.text
        )
        seedWelcomeMessageIfNeeded()
    }

    private func mapMessage(_ item: ChatMessageItem) -> GenerateMessage {
        let normalizedRole = item.role == "user" ? "user" : "assistant"
        let normalizedContent: String
        if normalizedRole == "assistant" {
            normalizedContent = normalizeAssistantMessageContent(item.content)
        } else {
            normalizedContent = item.content
        }

        let timestamp: Date
        if let createdAt = item.createdAt,
           let parsed = ISO8601DateFormatter().date(from: createdAt) {
            timestamp = parsed
        } else {
            timestamp = .now
        }

        return GenerateMessage(
            id: item.id,
            role: normalizedRole,
            content: normalizedContent,
            timestamp: timestamp,
            isPending: false
        )
    }

    @discardableResult
    private func appendLocalMessage(role: String, content: String, isPending: Bool = false) -> String {
        let messageId = "\(role)-local-\(UUID().uuidString)"
        let message = GenerateMessage(
            id: messageId,
            role: role,
            content: content,
            timestamp: .now,
            isPending: isPending
        )
        messages.append(message)
        return messageId
    }

    private func markMessagePending(messageId: String, isPending: Bool) {
        guard let index = messages.firstIndex(where: { $0.id == messageId }) else { return }
        messages[index].isPending = isPending
    }

    private func resetCandidateToIdeationInPlace() {
        guard var session = chatSession else { return }
        session.candidateRecipeSet = nil
        session.loopState = .ideation
        session.uiHints = nil
        chatSession = session
        isGenerationAnimationActive = false
    }

    private func handleServerError(_ error: Error, resetCandidateOnMissing: Bool = false) -> Bool {
        guard let apiError = error as? APIError else { return false }

        if apiError.serverStatusCode == 409 && apiError.serverCode == "candidate_missing" {
            if resetCandidateOnMissing {
                resetCandidateToIdeationInPlace()
            }
            self.error = "That draft recipe is no longer available. Send a new message to generate again."
            return true
        }

        if apiError.serverStatusCode == 409 && apiError.serverCode == "candidate_last_component" {
            self.error = "At least one recipe tab must remain."
            return true
        }

        if apiError.serverStatusCode == 404 && apiError.serverCode == "chat_not_found" {
            resetAll()
            self.error = "This chat session expired. Start a new chat to continue."
            return true
        }

        if apiError.serverStatusCode == 404 && apiError.serverCode == "route_not_found" {
            assertionFailure("Deprecated generate endpoint path still being used by client integration.")
            self.error = "Integration error: route not found."
            return true
        }

        if apiError.serverStatusCode == 403 {
            self.error = "Access denied for chat loop mutation."
            return true
        }

        return false
    }

    private func reconcileSession(api: APIClient) async {
        guard let chatId else { return }
        do {
            let session = try await api.getChat(id: chatId)
            applySession(session)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func reconcileAfterCandidateMutationFailure(error: Error, api: APIClient) async {
        if handleServerError(error, resetCandidateOnMissing: true) {
            return
        }

        await reconcileSession(api: api)
        if self.error == nil {
            self.error = "Couldn’t update recipe tabs. Please try again."
        }
    }

    private func updateGenerationAnimationState(from session: ChatSession) {
        if session.responseContext?.intent == .outOfScope {
            isGenerationAnimationActive = false
            generationAnimationTask?.cancel()
            generationAnimationTask = nil
            return
        }

        guard
            session.loopState == .candidatePresented,
            let candidateSet = session.candidateRecipeSet
        else {
            isGenerationAnimationActive = false
            generationAnimationTask?.cancel()
            generationAnimationTask = nil
            return
        }

        let shouldShowAnimation = session.uiHints?.showGenerationAnimation == true
        guard shouldShowAnimation else {
            return
        }

        let key = "\(candidateSet.candidateId):\(candidateSet.revision)"
        guard !shownGenerationAnimationKeys.contains(key) else {
            return
        }

        shownGenerationAnimationKeys.insert(key)
        isGenerationAnimationActive = true
        generationAnimationTask?.cancel()
        generationAnimationTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(1200))
            guard let self else { return }
            self.isGenerationAnimationActive = false
        }
    }

    private func seedWelcomeMessageIfNeeded() {
        guard messages.isEmpty else { return }
        replaceWelcomeMessage(text: makeWelcomeMessage())
    }

    private func replaceWelcomeMessage(text: String) {
        let welcome = GenerateMessage(
            id: Self.welcomeMessageId,
            role: "assistant",
            content: text,
            timestamp: .now
        )

        if let existingIndex = messages.firstIndex(where: { $0.id == Self.welcomeMessageId }) {
            messages[existingIndex] = welcome
        } else {
            messages.insert(welcome, at: 0)
        }
    }

    private func makeWelcomeMessage() -> String {
        var options = Self.genericWelcomeVariants

        if let previous = lastWelcomeMessageText {
            options = options.filter { $0 != previous }
        }
        if options.isEmpty {
            options = Self.genericWelcomeVariants
        }

        let selected = options.randomElement() ?? Self.genericWelcomeVariants[0]
        lastWelcomeMessageText = selected
        return selected
    }

    private func mergeServerMessages(
        _ serverMessages: [ChatMessageItem],
        assistantReplyFallback: String?
    ) {
        guard !serverMessages.isEmpty else { return }
        let mapped = serverMessages.map { item in
            let normalizedRole = item.role == "user" ? "user" : "assistant"
            if normalizedRole == "assistant" {
                return GenerateMessage(
                    id: item.id,
                    role: normalizedRole,
                    content: normalizeAssistantMessageContent(
                        item.content,
                        fallbackAssistantReplyText: assistantReplyFallback
                    ),
                    timestamp: {
                        if let createdAt = item.createdAt,
                           let parsed = ISO8601DateFormatter().date(from: createdAt) {
                            return parsed
                        }
                        return .now
                    }(),
                    isPending: false
                )
            }
            return mapMessage(item)
        }

        let pendingLocalMessages = messages.filter(\.isPending)

        let welcome = messages.first(where: { $0.id == Self.welcomeMessageId })
        let serverHasEquivalentWelcome = mapped.contains {
            $0.role == "assistant"
                && $0.content.trimmingCharacters(in: .whitespacesAndNewlines)
                    == welcome?.content.trimmingCharacters(in: .whitespacesAndNewlines)
        }

        var merged: [GenerateMessage] = []
        if let welcome, !serverHasEquivalentWelcome {
            merged.append(welcome)
        }
        merged.append(contentsOf: mapped)

        // Keep only optimistic messages that have not yet arrived from the server.
        for pending in pendingLocalMessages where !mapped.contains(where: {
            $0.role == pending.role &&
                $0.content.trimmingCharacters(in: .whitespacesAndNewlines)
                    == pending.content.trimmingCharacters(in: .whitespacesAndNewlines)
        }) {
            merged.append(pending)
        }

        messages = merged
    }

    private func normalizeAssistantMessageContent(
        _ content: String,
        fallbackAssistantReplyText: String? = nil
    ) -> String {
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return content }
        guard trimmed.first == "{" || trimmed.first == "[" else { return content }

        if let data = trimmed.data(using: .utf8),
           let rawJSON = try? JSONSerialization.jsonObject(with: data),
           let extracted = extractAssistantText(fromJSONValue: rawJSON)?
                .trimmingCharacters(in: .whitespacesAndNewlines),
           !extracted.isEmpty {
            return extracted
        }

        if let fallbackAssistantReplyText {
            let fallback = fallbackAssistantReplyText.trimmingCharacters(in: .whitespacesAndNewlines)
            if !fallback.isEmpty { return fallback }
        }

        return "..."
    }

    private func extractAssistantText(fromJSONValue value: Any) -> String? {
        if let object = value as? [String: Any] {
            if let assistantReply = object["assistant_reply"] {
                if let text = extractAssistantText(fromAssistantReplyPayload: assistantReply) {
                    return text
                }
            }

            if let text = object["text"] as? String,
               !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return text
            }

            if let message = object["message"] as? String,
               !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return message
            }

            for child in object.values {
                if let extracted = extractAssistantText(fromJSONValue: child) {
                    return extracted
                }
            }
        }

        if let array = value as? [Any] {
            for child in array {
                if let extracted = extractAssistantText(fromJSONValue: child) {
                    return extracted
                }
            }
        }

        return nil
    }

    private func extractAssistantText(fromAssistantReplyPayload payload: Any) -> String? {
        if let replyObject = payload as? [String: Any],
           let text = replyObject["text"] as? String,
           !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return text
        }
        return extractAssistantText(fromJSONValue: payload)
    }

    private func advanceTypingDescriptor() {
        let count = Self.typingDescriptors.count
        guard count > 0 else { return }
        guard count > 1 else {
            typingDescriptorIndex = 0
            return
        }

        var nextIndex = Int.random(in: 0..<count)
        if nextIndex == typingDescriptorIndex {
            nextIndex = (nextIndex + 1) % count
        }
        typingDescriptorIndex = nextIndex
    }
}
