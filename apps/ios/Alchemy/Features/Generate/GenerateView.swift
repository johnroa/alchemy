import SwiftUI
import Lottie

struct GenerateView: View {
    @Environment(APIClient.self) private var api
    @EnvironmentObject private var keyboard: KeyboardMonitor
    @Bindable var vm: GenerateViewModel

    @FocusState private var isInputFocused: Bool
    @State private var showResetConfirmation = false
    @State private var messageContentHeight: CGFloat = 0
    @State private var messageViewportHeight: CGFloat = 0

    var onProfileTap: () -> Void = {}
    var onGoToCookbook: ([String]) -> Void = { _ in }

    init(
        viewModel: GenerateViewModel,
        onProfileTap: @escaping () -> Void = {},
        onGoToCookbook: @escaping ([String]) -> Void = { _ in }
    ) {
        self._vm = Bindable(viewModel)
        self.onProfileTap = onProfileTap
        self.onGoToCookbook = onGoToCookbook
    }

    private var panelExpanded: Bool {
        vm.uiState == .ideation || !vm.hasCandidate
    }

    private var chatWindowTopGap: CGFloat {
        vm.hasCandidate ? 18 : 92
    }

    private var composerBottomInset: CGFloat {
        keyboard.height > 0 ? keyboard.height + 12 : Sizing.tabBarHeight + 72
    }

    private var chatDockReservedHeight: CGFloat {
        let composerHeight: CGFloat = 56
        let iteratingHeight: CGFloat = vm.uiState == .iterating ? 44 : 0
        let dockSpacing = Spacing.sm + Spacing.xs
        return composerHeight + iteratingHeight + dockSpacing + composerBottomInset
    }

    private var messageListIsScrollable: Bool {
        messageContentHeight > (messageViewportHeight + 1)
    }

    var body: some View {
        NavigationStack {
            ZStack {
                AlchemyColors.deepDark.ignoresSafeArea()

                VStack(spacing: 0) {
                    generateHeader
                        .padding(.bottom, chatWindowTopGap)

                    ZStack(alignment: .top) {
                        recipeBackdrop
                            .frame(maxWidth: .infinity, maxHeight: .infinity)

                        if vm.hasCandidate {
                            VStack(spacing: Spacing.sm2) {
                                candidateTabs
                                candidateActions
                            }
                            .padding(.horizontal, Spacing.md)
                            .padding(.top, Spacing.sm2)
                        }

                    chatPanel
                        .padding(.horizontal, Spacing.xs)
                        .zIndex(5)
                    }
                }
            }
            .toolbar(.hidden, for: .navigationBar)
        }
        .ignoresSafeArea(.keyboard, edges: .bottom)
        .confirmationDialog(
            "Start over?",
            isPresented: $showResetConfirmation,
            titleVisibility: .visible
        ) {
            Button("Start Over", role: .destructive) {
                Task { await vm.clearCandidate(api: api) }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This clears the current draft and returns to chat in the same session.")
        }
        .confirmationDialog(
            "Recipes saved",
            isPresented: $vm.showCommitOptionsSheet,
            titleVisibility: .visible
        ) {
            Button("Continue Chat") {
                vm.continueChatAfterCommit()
            }
            Button("Restart Chat") {
                vm.restartChatAfterCommit()
            }
            Button("Go to Cookbook") {
                let recipeIds = vm.takeCommittedRecipeIds()
                onGoToCookbook(recipeIds)
            }
        }
    }

    // MARK: - Header

    private var generateHeader: some View {
        AlchemyScreenHeader(
            title: "Generate Recipe",
            onProfileTap: onProfileTap,
            leading: vm.hasCandidate
                ? AnyView(
                    Button {
                        showResetConfirmation = true
                    } label: {
                        Image(systemName: "arrow.counterclockwise")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(AlchemyColors.textSecondary)
                            .frame(width: 34, height: 34)
                            .background(Circle().fill(Color.white.opacity(0.08)))
                    }
                    .buttonStyle(.plain)
                )
                : nil
        )
    }

    // MARK: - Background Content

    @ViewBuilder
    private var recipeBackdrop: some View {
        if let recipe = vm.activeRecipe {
            recipeScrollView(recipe)
                .opacity(vm.uiState == .iterating ? 0.5 : 1)
        } else if vm.shouldShowRecipeSkeleton {
            subtleRecipeSkeleton
                .padding(.horizontal, Spacing.md)
                .padding(.top, vm.hasCandidate ? 82 : Spacing.lg2)
                .padding(.bottom, Sizing.tabBarHeight + 24)
                .allowsHitTesting(false)
                .transition(.opacity)
        }
    }

    private var subtleRecipeSkeleton: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            RoundedRectangle(cornerRadius: 8)
                .fill(Color.white.opacity(0.028))
                .frame(width: 180, height: 12)

            RoundedRectangle(cornerRadius: 8)
                .fill(Color.white.opacity(0.022))
                .frame(maxWidth: .infinity, minHeight: 10, maxHeight: 10)
            RoundedRectangle(cornerRadius: 8)
                .fill(Color.white.opacity(0.02))
                .frame(width: 260, height: 10)

            RoundedRectangle(cornerRadius: Radius.lg)
                .fill(Color.white.opacity(0.017))
                .frame(height: 128)
                .overlay(
                    RoundedRectangle(cornerRadius: Radius.lg)
                        .stroke(Color.white.opacity(0.04), lineWidth: 0.6)
                )

            Spacer(minLength: 0)
        }
        .opacity(0.42)
    }

    // MARK: - Candidate Tabs

    private var candidateTabs: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Spacing.sm) {
                ForEach(vm.candidateComponents) { component in
                    candidateTab(for: component)
                }
            }
            .padding(.vertical, 2)
        }
    }

    private func candidateTab(for component: CandidateRecipeComponent) -> some View {
        let isActive = vm.activeComponentId == component.componentId
        let canDelete = vm.candidateComponents.count > 1

        return HStack(spacing: 6) {
            Button {
                Task { await vm.switchActiveComponent(component.componentId, api: api) }
            } label: {
                Text(component.title)
                    .font(AlchemyFont.captionLight)
                    .foregroundStyle(isActive ? AlchemyColors.textPrimary : AlchemyColors.textSecondary)
                    .lineLimit(1)
                    .padding(.horizontal, Spacing.sm2)
                    .padding(.vertical, Spacing.sm)
            }
            .buttonStyle(.plain)

            if canDelete {
                Button {
                    Task { await vm.deleteComponent(component.componentId, api: api) }
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(AlchemyColors.textTertiary)
                }
                .buttonStyle(.plain)
                .padding(.trailing, Spacing.sm)
            }
        }
        .chatLiquidSurface(
            role: .chip,
            focused: isActive,
            cornerRadius: Radius.lg
        )
    }

    private var candidateActions: some View {
        HStack(spacing: Spacing.sm2) {
            Button {
                Task { await vm.commitCandidate(api: api) }
            } label: {
                HStack(spacing: Spacing.xs) {
                    if vm.isCommitting {
                        ProgressView()
                            .tint(AlchemyColors.textPrimary)
                            .scaleEffect(0.85)
                    }
                    Text("Add All to Cookbook")
                        .font(AlchemyFont.bodyBold)
                        .foregroundStyle(AlchemyColors.textPrimary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, Spacing.sm)
            }
            .disabled(vm.isCommitting || vm.isMutatingCandidate)
            .buttonStyle(.plain)
            .chatLiquidSurface(role: .chip, focused: true, cornerRadius: Radius.lg)
        }
    }

    // MARK: - Chat Panel

    private var chatPanel: some View {
        ZStack(alignment: .bottom) {
            if panelExpanded {
                messageTimeline
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                    .padding(.top, Spacing.lg + 4)
                    .padding(.bottom, chatDockReservedHeight)
            } else {
                messageTimeline
                    .frame(maxWidth: .infinity, maxHeight: 170, alignment: .top)
                    .padding(.top, Spacing.md)
                    .padding(.bottom, chatDockReservedHeight)
            }

            VStack(spacing: Spacing.xs) {
                if vm.uiState == .iterating {
                    iteratingShell
                        .padding(.horizontal, Spacing.md)
                }

                chatComposer
                    .padding(.horizontal, Spacing.md)
            }
            .padding(.bottom, composerBottomInset)
            .padding(.top, Spacing.sm)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        .chatLiquidPanelBackground(
            UnevenRoundedRectangle(
                topLeadingRadius: 26,
                bottomLeadingRadius: 0,
                bottomTrailingRadius: 0,
                topTrailingRadius: 26
            )
        )
        .ignoresSafeArea(.container, edges: .bottom)
        .animation(.spring(response: 0.38, dampingFraction: 0.86), value: panelExpanded)
        .animation(.spring(response: 0.35, dampingFraction: 0.88), value: vm.uiState)
    }

    private var messageTimeline: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: Spacing.sm2) {
                    if vm.messages.isEmpty {
                        introMessage
                    }

                    ForEach(vm.messages) { message in
                        chatBubble(message)
                            .id(message.id)
                    }

                    if !vm.suggestions.isEmpty && !vm.isSendingMessage {
                        suggestionChips
                    }

                    if vm.isSendingMessage {
                        thinkingShell
                            .padding(.horizontal, Spacing.md)
                            .id("thinking")
                    }

                    if let error = vm.error {
                        Text(error)
                            .font(AlchemyFont.captionLight)
                            .foregroundStyle(AlchemyColors.danger)
                            .padding(.horizontal, Spacing.md)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .background(
                    GeometryReader { geo in
                        Color.clear
                            .preference(
                                key: GenerateMessageContentHeightKey.self,
                                value: geo.size.height
                            )
                    }
                )
                .padding(.bottom, Spacing.sm)
            }
            .background(
                GeometryReader { geo in
                    Color.clear
                        .preference(
                            key: GenerateMessageViewportHeightKey.self,
                            value: geo.size.height
                        )
                }
            )
            .scrollDisabled(!messageListIsScrollable)
            .scrollDismissesKeyboard(.interactively)
            .overlay(alignment: .top) {
                if messageListIsScrollable {
                    messageTopFade
                }
            }
            .onPreferenceChange(GenerateMessageContentHeightKey.self) { messageContentHeight = $0 }
            .onPreferenceChange(GenerateMessageViewportHeightKey.self) { messageViewportHeight = $0 }
            .onChange(of: vm.messages.count) { _, _ in
                if let lastId = vm.messages.last?.id {
                    withAnimation(.easeOut(duration: 0.2)) {
                        proxy.scrollTo(lastId, anchor: .bottom)
                    }
                }
            }
        }
    }

    private var messageTopFade: some View {
        ZStack(alignment: .top) {
            Rectangle()
                .fill(.ultraThinMaterial)
                .opacity(0.32)
                .mask(
                    LinearGradient(
                        colors: [.black.opacity(0.95), .clear],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )

            LinearGradient(
                colors: [
                    Color.black.opacity(0.34),
                    Color.black.opacity(0.12),
                    .clear
                ],
                startPoint: .top,
                endPoint: .bottom
            )
        }
        .frame(height: 44)
        .allowsHitTesting(false)
    }

    private var introMessage: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(vm.welcomePromptText)
                .font(AlchemyFont.chatBody)
                .foregroundStyle(AlchemyColors.textPrimary.opacity(0.98))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.leading, Spacing.sm2)
                .padding(.vertical, 2)
                .shadow(color: Color.black.opacity(0.32), radius: 2, x: 0, y: 1)

            Text(Date.now, style: .time)
                .font(AlchemyFont.chatTimestamp)
                .foregroundStyle(AlchemyColors.textTertiary)
                .padding(.leading, Spacing.sm2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.leading, 32)
        .padding(.trailing, 32)
    }

    private func chatBubble(_ message: GenerateMessage) -> some View {
        let isUser = message.role == "user"
        let timestampLeadingInset = isUser ? 0.0 : Spacing.sm2
        let timestampTrailingInset = isUser ? Spacing.md : 0.0

        return VStack(alignment: isUser ? .trailing : .leading, spacing: 4) {
            HStack {
                if isUser { Spacer(minLength: 60) }

                if isUser {
                    Text(message.content)
                        .font(AlchemyFont.chatBody)
                        .foregroundStyle(AlchemyColors.textPrimary)
                        .padding(.horizontal, Spacing.md)
                        .padding(.vertical, Spacing.sm2)
                        .chatLiquidSurface(
                            role: .userBubble,
                            focused: false,
                            cornerRadius: Radius.lg
                        )
                } else {
                    Text(message.content)
                        .font(AlchemyFont.chatBody)
                        .foregroundStyle(AlchemyColors.textPrimary.opacity(0.98))
                        .padding(.horizontal, Spacing.sm2)
                        .padding(.vertical, 2)
                        .shadow(color: Color.black.opacity(0.32), radius: 2, x: 0, y: 1)
                }

                if !isUser { Spacer(minLength: 60) }
            }

            Text(message.timestamp, style: .time)
                .font(AlchemyFont.chatTimestamp)
                .foregroundStyle(AlchemyColors.textTertiary)
                .padding(.leading, timestampLeadingInset)
                .padding(.trailing, timestampTrailingInset)
        }
        .padding(.horizontal, Spacing.md)
    }

    private var suggestionChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Spacing.sm) {
                ForEach(vm.suggestions, id: \.self) { suggestion in
                    Button {
                        Task { await vm.sendMessage(text: suggestion, api: api) }
                    } label: {
                        Text(suggestion)
                            .font(AlchemyFont.captionLight)
                            .foregroundStyle(AlchemyColors.textPrimary)
                            .padding(.horizontal, Spacing.sm2)
                            .padding(.vertical, Spacing.sm)
                            .chatLiquidSurface(role: .chip, focused: false, cornerRadius: Radius.lg)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, Spacing.md)
        }
    }

    private var thinkingShell: some View {
        HStack(spacing: Spacing.sm) {
            LottieView(animation: .named("alchemy-loading"))
                .playbackMode(.playing(.toProgress(1, loopMode: .loop)))
                .frame(width: 26, height: 26)
            Text(vm.typingDescriptor)
                .font(AlchemyFont.captionLight)
                .foregroundStyle(AlchemyColors.textSecondary)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, Spacing.md)
        .padding(.vertical, Spacing.sm)
        .chatLiquidSurface(role: .shell, focused: false, cornerRadius: Radius.lg)
    }

    private var iteratingShell: some View {
        HStack(spacing: Spacing.sm) {
            LottieView(animation: .named("alchemy-loading"))
                .playbackMode(.playing(.toProgress(1, loopMode: .loop)))
                .frame(width: 24, height: 24)

            Text("Updating recipe…")
                .font(AlchemyFont.captionLight)
                .foregroundStyle(AlchemyColors.textSecondary)

            Spacer(minLength: 0)
        }
        .padding(.horizontal, Spacing.md)
        .padding(.vertical, Spacing.sm)
        .chatLiquidSurface(role: .shell, focused: false, cornerRadius: Radius.lg)
    }

    // MARK: - Composer

    private var chatComposer: some View {
        let sendDisabled = vm.isSendingMessage || vm.input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty

        return ZStack(alignment: .trailing) {
            TextField(
                "",
                text: $vm.input,
                prompt: Text("I want some ideas for dinner tonight")
                    .foregroundStyle(Color.white.opacity(0.56)),
                axis: .vertical
            )
            .font(AlchemyFont.body)
            .foregroundStyle(AlchemyColors.textPrimary)
            .tint(AlchemyColors.gold)
            .lineLimit(1...6)
            .focused($isInputFocused)
            .padding(.leading, Spacing.md)
            .padding(.trailing, 50)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)

            Button {
                Task { await vm.sendMessage(api: api) }
            } label: {
                Image(systemName: "paperplane.fill")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(
                        LinearGradient(
                            colors: [
                                Color.white.opacity(0.98),
                                Color(hex: 0xDFE9F3).opacity(0.92)
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    .frame(width: 26, height: 26)
            }
            .disabled(sendDisabled)
            .opacity(sendDisabled ? 0.5 : 1)
            .padding(.trailing, 12)
        }
        .frame(minHeight: 52, alignment: .center)
        .chatLiquidSurface(role: .composer, focused: isInputFocused, cornerRadius: Radius.xl)
        .animation(.easeInOut(duration: 0.18), value: vm.input.count)
        .animation(.easeInOut(duration: 0.2), value: isInputFocused)
    }

    // MARK: - Recipe Detail

    private func recipeScrollView(_ recipe: RecipeView) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                Text(recipe.title)
                    .font(AlchemyFont.serifLG)
                    .foregroundStyle(AlchemyColors.textPrimary)

                if let description = recipe.description, !description.isEmpty {
                    Text(description)
                        .font(AlchemyFont.bodySmallLight)
                        .foregroundStyle(AlchemyColors.textSecondary)
                } else {
                    Text(recipe.summary)
                        .font(AlchemyFont.bodySmallLight)
                        .foregroundStyle(AlchemyColors.textSecondary)
                }

                HStack(spacing: Spacing.lg) {
                    if let timing = recipe.metadata?.timing, let total = timing.totalMinutes {
                        HStack(spacing: Spacing.xs) {
                            Image(systemName: "clock")
                                .font(.system(size: 14))
                                .foregroundStyle(AlchemyColors.textSecondary)
                            Text("\(total) min")
                                .font(AlchemyFont.captionLight)
                                .foregroundStyle(AlchemyColors.textSecondary)
                        }
                    }

                    HStack(spacing: Spacing.xs) {
                        Image(systemName: "person.2")
                            .font(.system(size: 14))
                            .foregroundStyle(AlchemyColors.textSecondary)
                        Text("Serves \(recipe.servings)")
                            .font(AlchemyFont.captionLight)
                            .foregroundStyle(AlchemyColors.textSecondary)
                    }
                }

                VStack(alignment: .leading, spacing: Spacing.sm) {
                    Text("Ingredients")
                        .font(AlchemyFont.titleSM)
                        .foregroundStyle(AlchemyColors.textPrimary)
                        .padding(.bottom, 2)

                    ForEach(recipe.ingredients) { ing in
                        VStack(spacing: 0) {
                            HStack {
                                Text(ing.name)
                                    .font(AlchemyFont.bodySmall)
                                    .foregroundStyle(AlchemyColors.textSecondary)
                                Spacer()
                                Text("\(ing.displayAmount ?? formatAmount(ing.amount)) \(ing.unit)")
                                    .font(AlchemyFont.bodyBold)
                                    .foregroundStyle(AlchemyColors.textPrimary)
                            }
                            .padding(.vertical, Spacing.sm)

                            Divider()
                                .overlay(AlchemyColors.elevated)
                        }
                    }
                }

                VStack(alignment: .leading, spacing: Spacing.sm) {
                    Text("Method")
                        .font(AlchemyFont.titleSM)
                        .foregroundStyle(AlchemyColors.textPrimary)
                        .padding(.bottom, 2)

                    ForEach(recipe.steps) { step in
                        HStack(alignment: .top, spacing: Spacing.sm) {
                            Text("\(step.index).")
                                .font(AlchemyFont.bodySmall)
                                .foregroundStyle(AlchemyColors.textTertiary)
                                .frame(width: 24, alignment: .leading)

                            Text(step.instruction)
                                .font(AlchemyFont.bodySmall)
                                .foregroundStyle(AlchemyColors.textSecondary)
                        }
                        .padding(.vertical, 2)
                    }
                }

                Color.clear.frame(height: 320)
            }
            .padding(.horizontal, Spacing.md)
            .padding(.top, 110)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private func formatAmount(_ amount: Double) -> String {
        amount.truncatingRemainder(dividingBy: 1) == 0
            ? String(format: "%.0f", amount)
            : String(format: "%.1f", amount)
    }
}

private struct GenerateMessageContentHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

private struct GenerateMessageViewportHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}
