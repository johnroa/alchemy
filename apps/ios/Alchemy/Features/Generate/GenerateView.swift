import SwiftUI
import Lottie
import UIKit

struct GenerateView: View {
    @Environment(APIClient.self) private var api
    @EnvironmentObject private var keyboard: KeyboardMonitor
    @Bindable var vm: GenerateViewModel

    @FocusState private var isInputFocused: Bool
    @State private var showResetConfirmation = false
    @State private var isCandidateChatExpanded = false
    @State private var messageContentHeight: CGFloat = 0
    @State private var messageViewportHeight: CGFloat = 0
    @State private var composerHeight: CGFloat = 50

    var onProfileTap: () -> Void = {}
    var onComposerFocusChange: (Bool) -> Void = { _ in }
    var onGoToCookbook: ([String]) -> Void = { _ in }

    init(
        viewModel: GenerateViewModel,
        onProfileTap: @escaping () -> Void = {},
        onComposerFocusChange: @escaping (Bool) -> Void = { _ in },
        onGoToCookbook: @escaping ([String]) -> Void = { _ in }
    ) {
        self._vm = Bindable(viewModel)
        self.onProfileTap = onProfileTap
        self.onComposerFocusChange = onComposerFocusChange
        self.onGoToCookbook = onGoToCookbook
    }

    private var messageListIsScrollable: Bool {
        messageContentHeight > (messageViewportHeight + 1)
    }

    private var showsChatPanel: Bool {
        switch vm.presentationMode {
        case .ideationExpanded:
            return true
        case .candidatePresented, .iterating:
            return isCandidateChatExpanded || isInputFocused
        case .generationMinimized:
            return false
        }
    }

    private var chatPanelTopInset: CGFloat { Spacing.xxxl + Spacing.xl + Spacing.md }

    private var bottomDockFloatingInset: CGFloat {
        keyboard.isVisible ? Spacing.xl : (Sizing.tabBarHeight + Spacing.xxxl)
    }

    private var messageListBottomInset: CGFloat {
        let dockHeight = composerHeight + Spacing.md +
            (vm.presentationMode == .iterating ? (44 + Spacing.sm2) : 0)
        switch vm.presentationMode {
        case .generationMinimized:
            return Sizing.tabBarHeight + Spacing.xl
        case .ideationExpanded, .candidatePresented, .iterating:
            return dockHeight + bottomDockFloatingInset + Spacing.lg
        }
    }

    private var userBubbleMaxWidth: CGFloat {
        UIScreen.main.bounds.width * 0.8
    }

    var body: some View {
        NavigationStack {
            ZStack {
                AlchemyColors.deepDark.ignoresSafeArea()
                ambientGradientBackdrop

                recipeBackdrop
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

                if vm.hasCandidate && vm.presentationMode != .generationMinimized {
                    VStack(spacing: Spacing.sm2) {
                        candidateTabs
                        candidateActions
                    }
                    .padding(.horizontal, Spacing.md)
                    .padding(.top, Spacing.sm2)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                }

                if showsChatPanel {
                    chatPanel
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                        .padding(.horizontal, Spacing.xs)
                        .ignoresSafeArea(.container, edges: .bottom)
                        .zIndex(5)
                }

                if vm.presentationMode == .generationMinimized {
                    generationMinimizedCenter
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
                        .transition(.opacity)
                }

            }
            .toolbar(.hidden, for: .navigationBar)
            .safeAreaInset(edge: .top, spacing: 0) {
                generateHeader
            }
            .overlay(alignment: .bottom) {
                bottomDock
                    .padding(.bottom, bottomDockFloatingInset)
                    .background(Color.clear)
                    .zIndex(15)
            }
        }
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
        .onChange(of: vm.presentationMode) { _, mode in
            if mode == .generationMinimized {
                dismissKeyboard()
                isInputFocused = false
                isCandidateChatExpanded = false
                onComposerFocusChange(false)
            }
        }
        .onChange(of: isInputFocused) { _, focused in
            onComposerFocusChange(focused)
            if focused, vm.hasCandidate {
                isCandidateChatExpanded = true
            } else if !focused && vm.presentationMode == .candidatePresented {
                withAnimation(.easeInOut(duration: 0.2)) {
                    isCandidateChatExpanded = false
                }
            }
        }
        .onAppear {
            isInputFocused = false
            onComposerFocusChange(false)
        }
        .onDisappear {
            onComposerFocusChange(false)
        }
        .onPreferenceChange(GenerateComposerHeightKey.self) { value in
            composerHeight = max(48, value)
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

    private var ambientGradientBackdrop: some View {
        Rectangle()
            .fill(Color.clear)
            .chatLiquidPanelBackground(Rectangle())
            .opacity(0.42)
            .ignoresSafeArea()
    }

    @ViewBuilder
    private var recipeBackdrop: some View {
        if let recipe = vm.activeRecipe {
            recipeScrollView(recipe)
                .opacity(vm.uiState == .iterating ? 0.5 : 1)
        } else if vm.shouldShowRecipeSkeleton {
            subtleRecipeSkeleton
                .padding(.horizontal, Spacing.md)
                .padding(.top, vm.hasCandidate ? Spacing.md : Spacing.lg)
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
        let panelShape = UnevenRoundedRectangle(
            topLeadingRadius: 16,
            bottomLeadingRadius: 0,
            bottomTrailingRadius: 0,
            topTrailingRadius: 16
        )

        return GeometryReader { proxy in
            let panelHeight = max(0, proxy.size.height - chatPanelTopInset)
            let timelineHeight = vm.presentationMode == .ideationExpanded
                ? panelHeight
                : min(260, panelHeight)

            ZStack(alignment: .bottom) {
                panelShape
                    .fill(Color.clear)
                    .chatLiquidPanelBackground(panelShape)
                    .frame(width: proxy.size.width, height: panelHeight)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)

                messageTimeline
                    .frame(
                        maxWidth: .infinity,
                        maxHeight: timelineHeight,
                        alignment: .top
                    )
                    .padding(.top, vm.presentationMode == .ideationExpanded ? Spacing.lg : Spacing.md)
                    .frame(maxWidth: .infinity, maxHeight: panelHeight, alignment: .top)
            }
            .frame(width: proxy.size.width, height: proxy.size.height, alignment: .bottom)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }

    private var messageTimeline: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: Spacing.sm2) {
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

                    if vm.isSendingMessage && vm.presentationMode != .iterating {
                        thinkingShell
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
                .padding(.bottom, messageListBottomInset)
                .frame(maxWidth: .infinity, alignment: .leading)
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
            .scrollDismissesKeyboard(.interactively)
            .scrollBounceBehavior(.always, axes: .vertical)
            .overlay(alignment: .top) {
                if messageListIsScrollable {
                    messageTopFade
                }
            }
            .onPreferenceChange(GenerateMessageContentHeightKey.self) { messageContentHeight = $0 }
            .onPreferenceChange(GenerateMessageViewportHeightKey.self) { messageViewportHeight = $0 }
            .onChange(of: vm.messages.last?.id) { _, lastId in
                guard let lastId else { return }
                withAnimation(.easeOut(duration: 0.2)) {
                    proxy.scrollTo(lastId, anchor: .bottom)
                }
            }
            .onChange(of: vm.isSendingMessage) { _, sending in
                guard sending else { return }
                withAnimation(.easeOut(duration: 0.2)) {
                    proxy.scrollTo("thinking", anchor: .bottom)
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

    private var bottomDock: some View {
        VStack(spacing: vm.presentationMode == .iterating ? Spacing.sm2 : Spacing.lg2) {
            switch vm.presentationMode {
            case .generationMinimized:
                compactGenerationStatus
                    .padding(.horizontal, Spacing.md)
            case .iterating:
                iteratingShell
                    .padding(.horizontal, Spacing.md)
                chatComposer
                    .padding(.horizontal, Spacing.md)
            case .candidatePresented:
                chatComposer
                    .padding(.horizontal, Spacing.md)
            case .ideationExpanded:
                chatComposer
                    .padding(.horizontal, Spacing.md)
            }
        }
        .padding(.top, Spacing.xs)
        .animation(.easeInOut(duration: 0.2), value: vm.presentationMode)
    }

    private var generationMinimizedCenter: some View {
        VStack(spacing: Spacing.md) {
            LottieView(animation: .named("alchemy-loading"))
                .playbackMode(.playing(.toProgress(1, loopMode: .loop)))
                .frame(width: 120, height: 120)

            Text("generating recipe...")
                .font(AlchemyFont.bodyBold)
                .foregroundStyle(AlchemyColors.textPrimary)
        }
    }

    private var compactGenerationStatus: some View {
        HStack(spacing: Spacing.sm) {
            LottieView(animation: .named("alchemy-loading"))
                .playbackMode(.playing(.toProgress(1, loopMode: .loop)))
                .frame(width: 42, height: 42)

            Text(vm.typingDescriptor)
                .font(AlchemyFont.chatBody)
                .foregroundStyle(AlchemyColors.textPrimary.opacity(0.98))
                .shadow(color: Color.black.opacity(0.32), radius: 2, x: 0, y: 1)

            Spacer(minLength: 0)
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, Spacing.xs)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var introMessage: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(vm.welcomePromptText)
                .font(AlchemyFont.chatBody)
                .foregroundStyle(AlchemyColors.textPrimary.opacity(0.98))
                .shadow(color: Color.black.opacity(0.32), radius: 2, x: 0, y: 1)

            Text(Date.now, style: .time)
                .font(AlchemyFont.chatTimestamp)
                .foregroundStyle(AlchemyColors.textTertiary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Spacing.lg)
    }

    private func chatBubble(_ message: GenerateMessage) -> some View {
        let isUser = message.role == "user"
        return Group {
            if isUser {
                HStack(spacing: 0) {
                    Spacer(minLength: 0)
                    VStack(alignment: .trailing, spacing: 4) {
                        userBubbleLabel(message.content)
                            .frame(maxWidth: userBubbleMaxWidth, alignment: .leading)

                        Text(message.timestamp, style: .time)
                            .font(AlchemyFont.chatTimestamp)
                            .foregroundStyle(AlchemyColors.textTertiary)
                            .frame(maxWidth: userBubbleMaxWidth, alignment: .trailing)
                    }
                    .frame(maxWidth: userBubbleMaxWidth, alignment: .trailing)
                }
                .frame(maxWidth: .infinity, alignment: .trailing)
                .padding(.horizontal, Spacing.md)
            } else {
                VStack(alignment: .leading, spacing: 4) {
                    Text(message.content)
                        .font(AlchemyFont.chatBody)
                        .foregroundStyle(AlchemyColors.textPrimary.opacity(0.98))
                        .shadow(color: Color.black.opacity(0.32), radius: 2, x: 0, y: 1)

                    Text(message.timestamp, style: .time)
                        .font(AlchemyFont.chatTimestamp)
                        .foregroundStyle(AlchemyColors.textTertiary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, Spacing.lg)
            }
        }
    }

    private func userBubbleLabel(_ text: String) -> some View {
        Text(text)
            .font(AlchemyFont.chatBody)
            .foregroundStyle(AlchemyColors.textPrimary)
            .multilineTextAlignment(.leading)
            .lineLimit(nil)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, Spacing.sm2)
            .chatLiquidSurface(
                role: .userBubble,
                focused: false,
                cornerRadius: Radius.lg
            )
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
                .frame(width: 72, height: 72)
                .scaleEffect(1.1)
            Text(vm.typingDescriptor)
                .font(AlchemyFont.chatBody)
                .foregroundStyle(AlchemyColors.textPrimary.opacity(0.98))
                .shadow(color: Color.black.opacity(0.32), radius: 2, x: 0, y: 1)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, Spacing.xs)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var iteratingShell: some View {
        HStack(spacing: Spacing.sm) {
            LottieView(animation: .named("alchemy-loading"))
                .playbackMode(.playing(.toProgress(1, loopMode: .loop)))
                .frame(width: 30, height: 30)

            Text("Updating recipe…")
                .font(AlchemyFont.chatBody)
                .foregroundStyle(AlchemyColors.textPrimary.opacity(0.98))
                .shadow(color: Color.black.opacity(0.32), radius: 2, x: 0, y: 1)

            Spacer(minLength: 0)
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, Spacing.xs)
        .frame(maxWidth: .infinity, alignment: .leading)
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
            .onTapGesture {
                onComposerFocusChange(true)
            }
            .padding(.leading, Spacing.md)
            .padding(.trailing, 44)
            .padding(.vertical, 11)
            .frame(maxWidth: .infinity, alignment: .leading)

            Button {
                Task { await vm.sendMessage(api: api) }
            } label: {
                Image(systemName: "paperplane.fill")
                    .font(.system(size: 10, weight: .semibold))
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
                    .frame(width: 14, height: 14)
                    .frame(width: 26, height: 26, alignment: .center)
            }
            .disabled(sendDisabled)
            .opacity(sendDisabled ? 0.5 : 1)
            .padding(.trailing, 13)
        }
        .frame(minHeight: 46, alignment: .center)
        .chatLiquidSurface(role: .composer, focused: isInputFocused, cornerRadius: Radius.xl)
        .background(
            GeometryReader { geo in
                Color.clear.preference(key: GenerateComposerHeightKey.self, value: geo.size.height)
            }
        )
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
            .padding(.top, 24)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private func formatAmount(_ amount: Double) -> String {
        amount.truncatingRemainder(dividingBy: 1) == 0
            ? String(format: "%.0f", amount)
            : String(format: "%.1f", amount)
    }

    private func dismissKeyboard() {
        UIApplication.shared.sendAction(
            #selector(UIResponder.resignFirstResponder),
            to: nil,
            from: nil,
            for: nil
        )
    }
}

private struct GenerateMessageContentHeightKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

private struct GenerateMessageViewportHeightKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

private struct GenerateComposerHeightKey: PreferenceKey {
    static let defaultValue: CGFloat = 50
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}
