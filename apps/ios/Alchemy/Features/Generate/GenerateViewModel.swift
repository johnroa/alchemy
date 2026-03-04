import SwiftUI

enum GenerateLoopUIState: Equatable {
    case ideation
    case candidatePresented
    case iterating
}

struct GenerateMessage: Identifiable {
    let id: String
    let role: String
    let content: String
    let timestamp: Date
}

@Observable
final class GenerateViewModel {
    private static let welcomeMessageId = "assistant-welcome"
    private static let genericWelcomeVariants = [
        "Hi Chef! What are we cooking today?",
        "Welcome back, Chef. What are we cooking today?",
        "Hey Chef! What sounds good to cook right now?",
        "Hi Chef! What are you in the mood to make?",
        "Chef, what should we cook up today?",
        "Hi Chef! What kind of recipe should I build for you?"
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

    init() {
        seedWelcomeMessageIfNeeded()
    }

    var loopState: ChatLoopState {
        chatSession?.loopState ?? .ideation
    }

    var uiState: GenerateLoopUIState {
        if isSendingMessage && hasCandidate {
            return .iterating
        }
        switch loopState {
        case .ideation:
            return .ideation
        case .candidatePresented:
            return .candidatePresented
        case .iterating:
            return .iterating
        }
    }

    var candidateRecipeSet: CandidateRecipeSet? {
        chatSession?.candidateRecipeSet
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
        hasCandidate && isSendingMessage && chatSession?.uiHints?.showGenerationAnimation == true
    }

    var typingDescriptor: String {
        Self.typingDescriptors[typingDescriptorIndex]
    }

    var shouldShowRecipeSkeleton: Bool {
        !hasCandidate && (messages.contains(where: { $0.role == "user" }) || isSendingMessage)
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

        appendLocalMessage(role: "user", content: trimmed)
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
        seedWelcomeMessageIfNeeded()
        typingDescriptorIndex = 0
    }

    private func applySession(_ session: ChatSession) {
        chatId = session.id
        chatSession = session
        optimisticActiveComponentId = nil

        mergeServerMessages(session.messages)
        seedWelcomeMessageIfNeeded()

        if let assistantText = session.assistantReply?.text.trimmingCharacters(in: .whitespacesAndNewlines), !assistantText.isEmpty {
            let shouldAppend = messages.last?.role != "assistant" || messages.last?.content != assistantText
            if shouldAppend {
                appendLocalMessage(role: "assistant", content: assistantText)
            }
        }
    }

    private func mapMessage(_ item: ChatMessageItem) -> GenerateMessage {
        let timestamp: Date
        if let createdAt = item.createdAt,
           let parsed = ISO8601DateFormatter().date(from: createdAt) {
            timestamp = parsed
        } else {
            timestamp = .now
        }

        return GenerateMessage(
            id: item.id,
            role: item.role,
            content: item.content,
            timestamp: timestamp
        )
    }

    private func appendLocalMessage(role: String, content: String) {
        let message = GenerateMessage(
            id: "\(role)-\(UUID().uuidString)",
            role: role,
            content: content,
            timestamp: .now
        )
        messages.append(message)
    }

    private func resetCandidateToIdeationInPlace() {
        guard var session = chatSession else { return }
        session.candidateRecipeSet = nil
        session.loopState = .ideation
        session.uiHints = nil
        chatSession = session
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

    private func mergeServerMessages(_ serverMessages: [ChatMessageItem]) {
        guard !serverMessages.isEmpty else { return }
        let mapped = serverMessages.map { mapMessage($0) }
        var existingIds = Set(messages.map(\.id))

        for message in mapped where !existingIds.contains(message.id) {
            let hasEquivalentLocal = messages.contains(where: {
                $0.role == message.role &&
                $0.content.trimmingCharacters(in: .whitespacesAndNewlines) == message.content.trimmingCharacters(in: .whitespacesAndNewlines)
            })
            if !hasEquivalentLocal {
                messages.append(message)
                existingIds.insert(message.id)
            }
        }
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
