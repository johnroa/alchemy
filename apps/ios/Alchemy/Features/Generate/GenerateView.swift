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
    /// Current vertical offset of the chat panel. 0 = fully expanded, maxDragRange = minimized.
    @State private var chatPanelOffset: CGFloat = 0
    /// Snapshot of chatPanelOffset captured when a drag begins.
    @State private var chatPanelDragStart: CGFloat = 0
    /// Whether a drag is in progress (used to capture start position once).
    @State private var chatPanelIsDragging = false

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

    /// Gap between the bottom dock (composer) and the screen bottom.
    /// When keyboard is up, use a modest inset. Otherwise sit just above the tab bar
    /// with a small margin (md = 16pt) so it doesn't float too far from the nav.
    /// The composer sits above whichever is taller: the tab bar or the keyboard.
    /// Because keyboard.height is animated by KeyboardMonitor, the composer
    /// smoothly rides up with the keyboard — no jump, no lag.
    private var bottomDockFloatingInset: CGFloat {
        max(Sizing.tabBarHeight + Spacing.md, keyboard.height + Spacing.sm)
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

    private var recipeTopInset: CGFloat {
        vm.hasCandidate && vm.presentationMode != .generationMinimized ? 108 : 24
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
                    .padding(.top, Spacing.xs)
                    .zIndex(15)
            }
        }
        .ignoresSafeArea(.keyboard)
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
            // Reset chat panel to expanded when mode changes, so the user
            // always starts in the natural position for each state.
            withAnimation(.spring(response: 0.35, dampingFraction: 0.86)) {
                chatPanelOffset = 0
                chatPanelDragStart = 0
            }
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
            // Fire the LLM greeting call on first appear; the fallback
            // is already visible so the user sees it instantly, then the
            // dynamic greeting swaps in once it arrives.
            if vm.chatId == nil && vm.messages.count <= 1 {
                Task { await vm.fetchGreeting(api: api) }
            }
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
                .animation(.easeInOut(duration: 0.3), value: vm.uiState == .iterating)
                .transition(.opacity.animation(.easeIn(duration: 0.3)))
        } else if vm.shouldShowRecipeSkeleton {
            // Active skeleton: pulsing while generation is in flight.
            subtleRecipeSkeleton
                .padding(.horizontal, Spacing.md)
                .padding(.top, vm.hasCandidate ? Spacing.md : Spacing.lg)
                .padding(.bottom, Sizing.tabBarHeight + 24)
                .allowsHitTesting(false)
                .transition(.opacity)
        } else if vm.presentationMode == .ideationExpanded {
            // "Faith" skeleton: recipe silhouette on the Generate Recipe page.
            // The chat panel floats above it and covers most of it. As the
            // user drags the chat panel down, the skeleton is revealed.
            faithRecipeSkeleton
                .padding(.horizontal, Spacing.md)
                .padding(.top, Spacing.lg)
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

    /// Faint recipe silhouette on the Generate page. The chat panel covers
    /// most of it; as the user drags the panel down, the skeleton is revealed.
    /// Opacities are intentionally very low so even the portions behind the
    /// frosted-glass chat panel don't visually bleed through.
    private var faithRecipeSkeleton: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0)) { timeline in
            let time = timeline.date.timeIntervalSinceReferenceDate
            // Slow sweep from left to right every ~3 seconds.
            let phase = CGFloat(fmod(time * 0.35, 1.0))

            VStack(alignment: .leading, spacing: Spacing.lg) {
                // Title placeholder
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color.white.opacity(0.07))
                    .frame(width: 200, height: 14)

                // Description lines
                RoundedRectangle(cornerRadius: 6)
                    .fill(Color.white.opacity(0.05))
                    .frame(maxWidth: .infinity, minHeight: 10, maxHeight: 10)
                RoundedRectangle(cornerRadius: 6)
                    .fill(Color.white.opacity(0.04))
                    .frame(width: 260, height: 10)

                // Timing / servings row
                HStack(spacing: Spacing.lg) {
                    RoundedRectangle(cornerRadius: 6)
                        .fill(Color.white.opacity(0.04))
                        .frame(width: 80, height: 10)
                    RoundedRectangle(cornerRadius: 6)
                        .fill(Color.white.opacity(0.04))
                        .frame(width: 80, height: 10)
                }

                // Ingredients block
                RoundedRectangle(cornerRadius: Radius.md)
                    .fill(Color.white.opacity(0.03))
                    .frame(height: 120)
                    .overlay(
                        RoundedRectangle(cornerRadius: Radius.md)
                            .stroke(Color.white.opacity(0.04), lineWidth: 0.5)
                    )

                // Steps block
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    ForEach(0..<3, id: \.self) { i in
                        RoundedRectangle(cornerRadius: 4)
                            .fill(Color.white.opacity(max(0.015, 0.035 - Double(i) * 0.008)))
                            .frame(maxWidth: .infinity, minHeight: 8, maxHeight: 8)
                    }
                }

                Spacer(minLength: 0)
            }
            .overlay(
                // Shimmer sweep — a soft highlight that glides across all bars.
                LinearGradient(
                    stops: [
                        .init(color: .clear, location: 0),
                        .init(color: Color.white.opacity(0.06), location: 0.45),
                        .init(color: Color.white.opacity(0.08), location: 0.5),
                        .init(color: Color.white.opacity(0.06), location: 0.55),
                        .init(color: .clear, location: 1)
                    ],
                    startPoint: .leading,
                    endPoint: .trailing
                )
                .scaleEffect(x: 2)
                .offset(x: UIScreen.main.bounds.width * (phase * 2 - 1))
                .blendMode(.plusLighter)
                .mask(
                    VStack(alignment: .leading, spacing: Spacing.lg) {
                        RoundedRectangle(cornerRadius: 8).frame(width: 200, height: 14)
                        RoundedRectangle(cornerRadius: 6).frame(maxWidth: .infinity, minHeight: 10, maxHeight: 10)
                        RoundedRectangle(cornerRadius: 6).frame(width: 260, height: 10)
                        HStack(spacing: Spacing.lg) {
                            RoundedRectangle(cornerRadius: 6).frame(width: 80, height: 10)
                            RoundedRectangle(cornerRadius: 6).frame(width: 80, height: 10)
                        }
                        RoundedRectangle(cornerRadius: Radius.md).frame(height: 120)
                        VStack(alignment: .leading, spacing: Spacing.sm) {
                            ForEach(0..<3, id: \.self) { _ in
                                RoundedRectangle(cornerRadius: 4).frame(maxWidth: .infinity, minHeight: 8, maxHeight: 8)
                            }
                        }
                        Spacer(minLength: 0)
                    }
                )
                .allowsHitTesting(false)
            )
        }
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

    /// Height of the pill-shaped drag handle area at the top of the chat panel.
    private let chatPanelHandleHeight: CGFloat = 28

    /// Maximum drag range, kept in sync via preference key from the panel's
    /// GeometryReader. Stored as @State so the gesture closure can read it
    /// without being inside the GeometryReader.
    @State private var chatPanelMaxDrag: CGFloat = 400

    private var chatPanel: some View {
        let panelShape = UnevenRoundedRectangle(
            topLeadingRadius: 16,
            bottomLeadingRadius: 0,
            bottomTrailingRadius: 0,
            topTrailingRadius: 16
        )

        // GeometryReader ONLY for measuring — the gesture and offset live
        // outside so drag state changes never trigger relayout inside.
        return GeometryReader { proxy in
            let fullPanelHeight = max(0, proxy.size.height - chatPanelTopInset)
            let bottomChrome = composerHeight + bottomDockFloatingInset + Spacing.sm
            let minPanelHeight = bottomChrome + chatPanelHandleHeight
            let maxDrag = max(0, fullPanelHeight - minPanelHeight)

            ZStack(alignment: .top) {
                panelShape
                    .fill(Color.clear)
                    .chatLiquidPanelBackground(panelShape)

                VStack(spacing: 0) {
                    // Drag handle
                    RoundedRectangle(cornerRadius: 2.5)
                        .fill(Color.white.opacity(0.35))
                        .frame(width: 36, height: 5)
                        .frame(maxWidth: .infinity)
                        .frame(height: chatPanelHandleHeight)

                    messageTimeline
                        .frame(maxWidth: .infinity, alignment: .top)
                        .padding(.top, Spacing.xs)
                        .clipped()
                }
            }
            .frame(height: fullPanelHeight)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
            .preference(key: GeneratePanelMaxDragKey.self, value: maxDrag)
        }
        .onPreferenceChange(GeneratePanelMaxDragKey.self) { chatPanelMaxDrag = $0 }
        // Offset + gesture live OUTSIDE the GeometryReader — offset is a
        // pure transform and the gesture writes to @State without triggering
        // relayout of the panel internals.
        .offset(y: chatPanelOffset)
        .contentShape(Rectangle())
        .gesture(
            DragGesture(minimumDistance: 4)
                .onChanged { value in
                    if !chatPanelIsDragging {
                        chatPanelDragStart = chatPanelOffset
                        chatPanelIsDragging = true
                    }
                    let proposed = chatPanelDragStart + value.translation.height
                    chatPanelOffset = min(max(0, proposed), chatPanelMaxDrag)
                }
                .onEnded { value in
                    chatPanelIsDragging = false
                    let velocity = value.predictedEndTranslation.height - value.translation.height
                    if velocity > 200 {
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.88)) {
                            chatPanelOffset = chatPanelMaxDrag
                        }
                    } else if velocity < -200 {
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.88)) {
                            chatPanelOffset = 0
                        }
                    }
                }
        )
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
            // Soft fade at the bottom edge so messages dissolve rather than
            // being hard-clipped. Top edge is left unmasked so text at rest
            // is never cut off.
            .mask(
                VStack(spacing: 0) {
                    Color.black
                    LinearGradient(
                        colors: [.black, .clear],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                    .frame(height: 24)
                }
            )
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
            .padding(.top, recipeTopInset)
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

private struct GeneratePanelMaxDragKey: PreferenceKey {
    static let defaultValue: CGFloat = 400
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}
