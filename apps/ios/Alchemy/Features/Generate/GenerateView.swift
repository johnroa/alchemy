import SwiftUI
import Lottie

struct GenerateView: View {
    @Environment(APIClient.self) private var api
    @EnvironmentObject private var keyboard: KeyboardMonitor
    @State private var vm = GenerateViewModel()
    @FocusState private var isInputFocused: Bool
    var onProfileTap: () -> Void = {}

    // Whether the glass chat panel is expanded (full-height) or collapsed (bottom bar)
    private var panelExpanded: Bool {
        switch vm.mode {
        case .idle, .chatting: return true
        case .generating, .recipe, .tweaking, .tweakLoading: return false
        }
    }

    private var messageListTopInset: CGFloat {
        vm.hasRecipe ? Spacing.sm2 : Spacing.lg2
    }

    // Figma: on default generate, the whole chat window starts lower on screen.
    private var chatWindowTopGap: CGFloat {
        vm.activeRecipe == nil ? 96 : 22
    }

    private var composerBottomInset: CGFloat {
        keyboard.height + Spacing.sm2
    }

    private var panelBottomClearance: CGFloat {
        // Smoothly hand off from tab-bar clearance to keyboard clearance to avoid a hard "kink".
        let tabBarClearance = Sizing.tabBarHeight + 24
        let blended = smoothMax(keyboard.height, tabBarClearance, softness: 22)
        return max(0, blended - keyboard.height)
    }

    var body: some View {
        ZStack {
            AlchemyColors.deepDark.ignoresSafeArea()

            VStack(spacing: 0) {
                generateHeader
                .padding(.bottom, chatWindowTopGap)

                // Content area — glass panel overlays recipe
                ZStack(alignment: .bottom) {
                    if let recipe = vm.activeRecipe {
                        recipeScrollView(recipe)
                            .opacity(vm.mode == .tweakLoading ? 0.3 : 1.0)
                    } else {
                        generatingSkeletonBackdrop
                            .padding(.horizontal, Spacing.md)
                            .padding(.top, Spacing.lg2)
                            .padding(.bottom, Sizing.tabBarHeight + 24)
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                            .allowsHitTesting(false)
                            .transition(.opacity)
                    }

                    // Centered loading animation (generating / tweaking)
                    if vm.mode == .generating {
                        generatingOverlay
                            .transition(.opacity)
                    }
                    if vm.mode == .tweakLoading {
                        tweakLoadingOverlay
                            .transition(.opacity)
                    }

                    // Glass chat panel — extends to bottom, behind tab bar
                    if vm.mode != .tweaking {
                        glassPanel
                            .animation(.spring(response: 0.4, dampingFraction: 0.85), value: panelExpanded)
                            .animation(.spring(response: 0.4, dampingFraction: 0.85), value: vm.mode)
                    }

                    // Tweak bottom sheet overlay
                    if vm.mode == .tweaking {
                        tweakSheet
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                    }
                }
            }

            // Saved toast
            if vm.showSavedConfirmation {
                savedToast
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .ignoresSafeArea(.keyboard, edges: .bottom)
        .animation(.easeInOut(duration: 0.35), value: vm.mode)
        .animation(.spring(response: 0.4), value: vm.showSavedConfirmation)
    }

    // MARK: - Glass Panel

    private var glassPanel: some View {
        VStack(spacing: 0) {
            if panelExpanded {
                expandedPanelContent
            } else {
                collapsedPanelContent
            }

            // Tab bar + safe area clearance inside the panel
            Color.clear.frame(height: panelBottomClearance)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        .glassPanelBackground()
        .ignoresSafeArea(.container, edges: .bottom)
    }

    // MARK: - Expanded Panel (idle, chatting, tweaking)

    private var expandedPanelContent: some View {
        VStack(spacing: 0) {
            // Drag handle (only when recipe exists — can collapse)
            if vm.hasRecipe {
                dragHandle
            }

            // Messages
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: Spacing.sm2) {
                        // Intro message for idle
                        if vm.messages.isEmpty {
                            introMessage
                        }

                        ForEach(vm.messages) { message in
                            chatBubble(message)
                                .id(message.id)
                        }

                        // Suggestion chips after the last assistant message
                        if !vm.suggestions.isEmpty && !vm.isLoading {
                            suggestionChips
                        }

                        if vm.isLoading {
                            thinkingIndicator
                                .id("loading")
                        }

                        if let error = vm.error {
                            Text(error)
                                .font(AlchemyFont.captionLight)
                                .foregroundStyle(AlchemyColors.danger)
                                .padding(.horizontal, Spacing.md)
                        }
                    }
                    .padding(.top, messageListTopInset)
                    .padding(.bottom, Spacing.sm)
                }
                .scrollDismissesKeyboard(.interactively)
                .simultaneousGesture(
                    DragGesture(minimumDistance: 8).onChanged { value in
                        if value.translation.height > 4 {
                            isInputFocused = false
                        }
                    }
                )
                .onChange(of: vm.messages.count) { _, _ in
                    if let lastId = vm.messages.last?.id {
                        withAnimation(.spring(response: 0.3)) {
                            proxy.scrollTo(lastId, anchor: .bottom)
                        }
                    }
                }
            }
            .padding(.top, 0)

            // Composer
            chatComposer
                .padding(.horizontal, Spacing.md)
                .padding(.bottom, composerBottomInset)
        }
    }

    // MARK: - Collapsed Panel (generating, recipe, tweakLoading)

    private var collapsedPanelContent: some View {
        VStack(spacing: Spacing.sm2) {
            if vm.mode == .generating || vm.mode == .tweakLoading {
                // Read-only pill showing last user message
                HStack {
                    Text(vm.lastUserMessage.isEmpty ? "Baking..." : vm.lastUserMessage)
                        .font(AlchemyFont.body)
                        .foregroundStyle(AlchemyColors.textTertiary)
                        .lineLimit(1)
                    Spacer()
                }
                .padding(.horizontal, Spacing.md)
                .padding(.vertical, Spacing.sm2)
                .background(AlchemyColors.card)
                .clipShape(RoundedRectangle(cornerRadius: Radius.lg))
                .padding(.horizontal, Spacing.sm2)
                .padding(.top, Spacing.sm2)
            }

            if vm.mode == .recipe {
                // Assistant reply + action buttons
                if let reply = vm.assistantReply {
                    Text(reply.text)
                        .font(AlchemyFont.body)
                        .foregroundStyle(AlchemyColors.textPrimary)
                        .padding(.horizontal, Spacing.md)
                        .padding(.vertical, Spacing.sm2)
                        .background(
                            RoundedRectangle(cornerRadius: Radius.lg)
                                .fill(AlchemyColors.elevated)
                        )
                        .padding(.horizontal, Spacing.sm2)
                        .padding(.top, Spacing.sm2)
                }

                // Action buttons
                HStack(spacing: Spacing.sm2) {
                    Button {
                        withAnimation(.spring(response: 0.4, dampingFraction: 0.85)) {
                            vm.isTweakSheetOpen = true
                        }
                    } label: {
                        Text("Make Tweaks")
                            .font(AlchemyFont.bodyBold)
                            .foregroundStyle(AlchemyColors.textPrimary)
                            .padding(.horizontal, Spacing.lg)
                            .padding(.vertical, Spacing.sm2)
                            .background(
                                Capsule().stroke(Color.white.opacity(0.2), lineWidth: 1)
                            )
                    }

                    Button {
                        Task { await vm.saveToCookbook(api: api) }
                    } label: {
                        HStack(spacing: Spacing.xs) {
                            if vm.isSaving {
                                ProgressView()
                                    .tint(AlchemyColors.textPrimary)
                                    .scaleEffect(0.8)
                            }
                            Text(vm.isSaved ? "Saved" : "Save to Cookbook")
                                .font(AlchemyFont.bodyBold)
                                .foregroundStyle(AlchemyColors.textPrimary)
                        }
                        .padding(.horizontal, Spacing.lg)
                        .padding(.vertical, Spacing.sm2)
                        .background(
                            Capsule().stroke(Color.white.opacity(0.2), lineWidth: 1)
                        )
                    }
                    .disabled(vm.isSaving || vm.isSaved)
                }
                .padding(.horizontal, Spacing.sm2)
                .padding(.bottom, Spacing.sm2)
            }
        }
    }

    // MARK: - Tweak Sheet (bottom overlay in tweaking mode)

    private var tweakSheet: some View {
        VStack(spacing: 0) {
            // Drag handle to dismiss
            Button {
                withAnimation(.spring(response: 0.4, dampingFraction: 0.85)) {
                    vm.isTweakSheetOpen = false
                }
            } label: {
                Capsule()
                    .fill(AlchemyColors.grey1.opacity(0.5))
                    .frame(width: 36, height: 4)
                    .padding(.top, Spacing.sm)
                    .padding(.bottom, Spacing.xs)
                    .frame(maxWidth: .infinity)
            }

            // Scrollable message history (compact)
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: Spacing.xs) {
                        ForEach(vm.messages.suffix(4)) { message in
                            chatBubble(message)
                                .id(message.id)
                        }

                        if !vm.suggestions.isEmpty && !vm.isLoading {
                            suggestionChips
                        }

                        if vm.isLoading {
                            thinkingIndicator
                                .id("loading")
                        }
                    }
                    .padding(.top, Spacing.xs)
                    .padding(.bottom, Spacing.xs)
                }
                .scrollDismissesKeyboard(.interactively)
                .simultaneousGesture(
                    DragGesture(minimumDistance: 8).onChanged { value in
                        if value.translation.height > 4 {
                            isInputFocused = false
                        }
                    }
                )
                .frame(maxHeight: 200)
                .onChange(of: vm.messages.count) { _, _ in
                    if let lastId = vm.messages.last?.id {
                        withAnimation(.spring(response: 0.3)) {
                            proxy.scrollTo(lastId, anchor: .bottom)
                        }
                    }
                }
            }

            // Composer
            chatComposer
                .padding(.horizontal, Spacing.md)
                .padding(.bottom, composerBottomInset)

            // Tab bar clearance
            Color.clear.frame(height: panelBottomClearance)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        .glassPanelBackground()
        .ignoresSafeArea(.container, edges: .bottom)
    }

    // MARK: - Intro Message

    private var introMessage: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("What would you like to make today?")
                .font(AlchemyFont.chatBody)
                .foregroundStyle(AlchemyColors.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, Spacing.md)
                .padding(.vertical, Spacing.sm2)
                .background(
                    RoundedRectangle(cornerRadius: Radius.lg)
                        .fill(Color.white.opacity(0.1))
                        .overlay(
                            RoundedRectangle(cornerRadius: Radius.lg)
                                .stroke(Color.white.opacity(0.2), lineWidth: 0.5)
                        )
                )

            Text(Date.now, style: .time)
                .font(AlchemyFont.chatTimestamp)
                .foregroundStyle(AlchemyColors.textTertiary)
                .padding(.horizontal, Spacing.xs)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.leading, 39)
        .padding(.trailing, 29)
    }

    // MARK: - Drag Handle

    private var dragHandle: some View {
        Capsule()
            .fill(AlchemyColors.grey1.opacity(0.5))
            .frame(width: 36, height: 4)
            .padding(.top, Spacing.sm)
            .padding(.bottom, Spacing.xs)
    }

    // MARK: - Thinking Indicator

    private var thinkingIndicator: some View {
        HStack(spacing: Spacing.sm) {
            LottieView(animation: .named("alchemy-loading"))
                .playbackMode(.playing(.toProgress(1, loopMode: .loop)))
                .frame(width: 28, height: 28)
            Text("Thinking...")
                .font(AlchemyFont.captionLight)
                .foregroundStyle(AlchemyColors.textTertiary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Spacing.md)
    }

    // MARK: - Generating Skeleton Backdrop

    private var generatingSkeletonBackdrop: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            subtleSkeletonBar(width: 142, height: 10)

            VStack(alignment: .leading, spacing: Spacing.sm) {
                subtleSkeletonBar(height: 13)
                subtleSkeletonBar(width: 234, height: 13)
                subtleSkeletonBar(width: 272, height: 13)
            }

            RoundedRectangle(cornerRadius: Radius.lg, style: .continuous)
                .fill(Color.white.opacity(0.014))
                .frame(height: 120)
                .overlay(
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        subtleSkeletonBar(width: 172, height: 11)
                        subtleSkeletonBar(height: 11)
                        subtleSkeletonBar(width: 208, height: 11)
                    }
                    .padding(Spacing.md),
                    alignment: .topLeading
                )
                .overlay(
                    RoundedRectangle(cornerRadius: Radius.lg, style: .continuous)
                        .stroke(Color.white.opacity(0.03), lineWidth: 0.6)
                )

            Spacer(minLength: 0)

            HStack(spacing: Spacing.sm2) {
                subtleSkeletonCapsule
                subtleSkeletonCapsule
            }
            .padding(.bottom, 6)
        }
        .opacity(0.24)
    }

    private var subtleSkeletonCapsule: some View {
        Capsule()
            .fill(Color.white.opacity(0.022))
            .frame(maxWidth: .infinity, minHeight: 40, maxHeight: 40)
            .overlay(
                Capsule()
                    .fill(Color.white.opacity(0.05))
                    .shimmer()
                    .opacity(0.14)
            )
            .overlay(
                Capsule()
                    .stroke(Color.white.opacity(0.03), lineWidth: 0.55)
            )
    }

    private func subtleSkeletonBar(width: CGFloat? = nil, height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 7, style: .continuous)
            .fill(Color.white.opacity(0.025))
            .frame(width: width, height: height)
            .overlay(
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .fill(Color.white.opacity(0.05))
                    .shimmer()
                    .opacity(0.14)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .stroke(Color.white.opacity(0.028), lineWidth: 0.5)
            )
    }

    // MARK: - Generating Overlay

    private var generatingOverlay: some View {
        VStack(spacing: Spacing.lg) {
            Spacer()

            LottieView(animation: .named("alchemy-loading"))
                .playbackMode(.playing(.toProgress(1, loopMode: .loop)))
                .frame(width: 160, height: 160)

            Text("generating recipe...")
                .font(AlchemyFont.titleMD)
                .foregroundStyle(AlchemyColors.textPrimary)

            Spacer()
            Spacer()
        }
    }

    // MARK: - Tweak Loading Overlay

    private var tweakLoadingOverlay: some View {
        VStack(spacing: Spacing.lg) {
            Spacer()

            LottieView(animation: .named("alchemy-loading"))
                .playbackMode(.playing(.toProgress(1, loopMode: .loop)))
                .frame(width: 160, height: 160)

            Text("tweaking recipe...")
                .font(AlchemyFont.titleMD)
                .foregroundStyle(AlchemyColors.textPrimary)

            Spacer()
            Spacer()
        }
    }

    // MARK: - Recipe Scroll View

    private func recipeScrollView(_ recipe: RecipeView) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                // Title
                Text(recipe.title)
                    .font(AlchemyFont.serifLG)
                    .foregroundStyle(AlchemyColors.textPrimary)

                // Description
                if let description = recipe.description, !description.isEmpty {
                    Text(description)
                        .font(AlchemyFont.bodySmallLight)
                        .foregroundStyle(AlchemyColors.textSecondary)
                } else {
                    Text(recipe.summary)
                        .font(AlchemyFont.bodySmallLight)
                        .foregroundStyle(AlchemyColors.textSecondary)
                }

                // Meta row
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

                // Ingredients
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

                // Method
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

                // Bottom padding for collapsed panel + tab bar
                Color.clear.frame(height: 320)
            }
            .padding(.horizontal, Spacing.md)
            .padding(.top, Spacing.lg2)
        }
        .scrollDismissesKeyboard(.interactively)
        .simultaneousGesture(
            DragGesture(minimumDistance: 8).onChanged { value in
                if value.translation.height > 4 {
                    isInputFocused = false
                }
            }
        )
    }

    // MARK: - Chat Bubble

    private func chatBubble(_ message: GenerateMessage) -> some View {
        VStack(alignment: message.role == "user" ? .trailing : .leading, spacing: 4) {
            HStack {
                if message.role == "user" { Spacer(minLength: 60) }

                Text(message.content)
                    .font(AlchemyFont.chatBody)
                    .foregroundStyle(AlchemyColors.textPrimary)
                    .padding(.horizontal, Spacing.md)
                    .padding(.vertical, Spacing.sm2)
                    .background(
                        RoundedRectangle(cornerRadius: Radius.lg)
                            .fill(message.role == "user" ? Color.white.opacity(0.2) : Color.white.opacity(0.1))
                            .overlay(
                                RoundedRectangle(cornerRadius: Radius.lg)
                                    .stroke(Color.white.opacity(message.role == "user" ? 0.35 : 0.2), lineWidth: 0.5)
                            )
                    )

                if message.role == "assistant" { Spacer(minLength: 60) }
            }

            Text(message.timestamp, style: .time)
                .font(AlchemyFont.chatTimestamp)
                .foregroundStyle(AlchemyColors.textTertiary)
                .padding(.horizontal, Spacing.xs)
        }
        .padding(.horizontal, Spacing.md)
    }

    // MARK: - Suggestion Chips

    private var suggestionChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Spacing.sm) {
                ForEach(vm.suggestions, id: \.self) { suggestion in
                    Button {
                        isInputFocused = false
                        vm.input = suggestion
                        Task { await vm.sendMessage(api: api) }
                    } label: {
                        Text(suggestion)
                            .font(AlchemyFont.captionLight)
                            .foregroundStyle(AlchemyColors.textPrimary)
                            .padding(.horizontal, Spacing.sm2)
                            .padding(.vertical, Spacing.sm)
                            .background(
                                Capsule()
                                    .stroke(Color.white.opacity(0.15), lineWidth: 1)
                            )
                    }
                }
            }
            .padding(.horizontal, Spacing.md)
        }
    }

    // MARK: - Chat Composer

    private var chatComposer: some View {
        let sendDisabled = vm.isLoading || vm.input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty

        return ZStack(alignment: .topTrailing) {
            TextField(
                "",
                text: $vm.input,
                prompt: Text("I want some ideas for dinner tonight")
                    .foregroundStyle(Color.white.opacity(0.48)),
                axis: .vertical
            )
                .font(AlchemyFont.body)
                .foregroundStyle(AlchemyColors.textPrimary)
                .tint(AlchemyColors.gold)
                .lineLimit(1...6)
                .focused($isInputFocused)
                .padding(.leading, Spacing.md)
                .padding(.trailing, 56)
                .padding(.vertical, 14)
                .frame(maxWidth: .infinity, alignment: .leading)

            Button {
                isInputFocused = false
                Task { await vm.sendMessage(api: api) }
            } label: {
                Image(systemName: "paperplane.fill")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(
                        LinearGradient(
                            colors: [
                                Color.white.opacity(0.98),
                                Color(hex: 0xD7E9FF).opacity(0.92)
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    .frame(width: 32, height: 32)
                    .shadow(color: Color(hex: 0x73B8FF).opacity(isInputFocused ? 0.35 : 0.2), radius: 6, x: 0, y: 1)
            }
            .disabled(sendDisabled)
            .opacity(sendDisabled ? 0.52 : 1)
            .padding(.trailing, Spacing.sm)
            .padding(.top, 10)
        }
        .frame(minHeight: 56, alignment: .top)
        .background(ephemeralComposerBackground)
        .shadow(
            color: Color(hex: 0x4EA6FF).opacity(isInputFocused ? 0.2 : 0.1),
            radius: isInputFocused ? 16 : 10,
            x: 0,
            y: 4
        )
        .animation(.easeInOut(duration: 0.22), value: isInputFocused)
        .animation(.easeInOut(duration: 0.18), value: vm.input.count)
    }

    private var ephemeralComposerBackground: some View {
        let shape = RoundedRectangle(cornerRadius: Radius.xl, style: .continuous)

        return TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: false)) { timeline in
            let time = timeline.date.timeIntervalSinceReferenceDate
            let sweep = CGFloat(sin(time * 0.34))

            ZStack {
                shape.fill(Color(hex: 0x182D44).opacity(0.88))
                shape.fill(.ultraThinMaterial).opacity(0.34)

                shape.fill(
                    LinearGradient(
                        colors: [
                            Color(hex: 0x234A74).opacity(0.5),
                            Color(hex: 0x162F49).opacity(0.42),
                            Color(hex: 0x1E3F63).opacity(0.48)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )

                shape
                    .fill(
                        RadialGradient(
                            colors: [
                                Color(hex: 0x7CC1FF).opacity(isInputFocused ? 0.22 : 0.12),
                                .clear
                            ],
                            center: UnitPoint(x: 0.16 + 0.06 * sweep, y: 0.44),
                            startRadius: 8,
                            endRadius: 190
                        )
                    )
                    .blendMode(.screen)

                shape
                    .fill(
                        LinearGradient(
                            colors: [
                                .clear,
                                Color.white.opacity(isInputFocused ? 0.2 : 0.12),
                                .clear
                            ],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .scaleEffect(x: 1.8, y: 1.0)
                    .offset(x: 82 * sweep)
                    .blur(radius: 12)
                    .opacity(0.3)
                    .mask(shape)

                shape
                    .stroke(Color.white.opacity(isInputFocused ? 0.24 : 0.14), lineWidth: 0.9)
                shape
                    .stroke(Color(hex: 0x8CC8FF).opacity(isInputFocused ? 0.25 : 0.13), lineWidth: 0.8)
                    .blur(radius: 0.8)
            }
        }
    }

    // MARK: - Header

    private var generateHeader: some View {
        HStack(alignment: .center, spacing: Spacing.md) {
            Text("Generate")
                .font(AlchemyFont.largeTitle)
                .foregroundStyle(AlchemyColors.textPrimary)
                .tracking(0.4)

            Spacer(minLength: Spacing.md)

            Button(action: onProfileTap) {
                Image("chef-hat")
                    .renderingMode(.template)
                    .resizable()
                    .scaledToFit()
                    .frame(width: 22, height: 22)
                    .foregroundStyle(AlchemyColors.grey2)
                    .frame(width: 36, height: 36)
                    .background(
                        Circle().fill(Color.white.opacity(0.6))
                    )
            }
            .buttonStyle(.plain)
        }
        .frame(height: 52)
        .padding(.horizontal, Spacing.md)
        .padding(.top, 20)
        .padding(.bottom, Spacing.sm)
    }

    // MARK: - Saved Toast

    private var savedToast: some View {
        VStack {
            HStack(spacing: Spacing.sm) {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(AlchemyColors.success)
                Text("Saved to Cookbook")
                    .font(AlchemyFont.bodyBold)
                    .foregroundStyle(AlchemyColors.textPrimary)
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, Spacing.sm2)
            .alchemyGlassCapsule()
            .padding(.top, Spacing.xxxl)

            Spacer()
        }
    }

    // MARK: - Helpers

    private func formatAmount(_ amount: Double) -> String {
        amount.truncatingRemainder(dividingBy: 1) == 0
            ? String(format: "%.0f", amount)
            : String(format: "%.1f", amount)
    }

    // Smooth approximation of max(a, b). Higher softness softens the handoff curve.
    private func smoothMax(_ a: CGFloat, _ b: CGFloat, softness: CGFloat) -> CGFloat {
        let delta = a - b
        return 0.5 * (a + b + sqrt((delta * delta) + (softness * softness)))
    }
}

// MARK: - Glass Panel Background (top corners only)

private extension View {
    func glassPanelBackground() -> some View {
        let shape = UnevenRoundedRectangle(
            topLeadingRadius: 40,
            bottomLeadingRadius: 0,
            bottomTrailingRadius: 0,
            topTrailingRadius: 40
        )

        return self
            .background(
                TimelineView(.animation(minimumInterval: 1.0 / 24.0, paused: false)) { timeline in
                    let time = timeline.date.timeIntervalSinceReferenceDate
                    let pulse = (sin(time * 0.18) + 1) / 2
                    let drift = CGFloat(sin(time * 0.14))
                    let driftY = CGFloat(cos(time * 0.12))

                    let baseGradient = LinearGradient(
                        stops: [
                            .init(color: Color(hex: 0x1B3248).opacity(0.55), location: 0.0),
                            .init(color: Color(hex: 0x0E2B42).opacity(0.5), location: 0.34),
                            .init(color: Color(hex: 0x081D34).opacity(0.46), location: 0.72),
                            .init(color: Color(hex: 0x051425).opacity(0.44), location: 1.0)
                        ],
                        startPoint: UnitPoint(
                            x: 0.76 + 0.05 * CGFloat(sin(time * 0.07)),
                            y: 0.06 + 0.03 * CGFloat(cos(time * 0.05))
                        ),
                        endPoint: UnitPoint(
                            x: 0.22 + 0.05 * CGFloat(cos(time * 0.06)),
                            y: 0.98 - 0.03 * CGFloat(sin(time * 0.05))
                        )
                    )

                    ZStack {
                        shape.fill(.ultraThinMaterial)
                        shape.fill(baseGradient)
                        shape
                            .fill(
                                RadialGradient(
                                    colors: [Color(hex: 0x4F88A9).opacity(0.22 + 0.06 * pulse), .clear],
                                    center: UnitPoint(x: 0.18 + 0.04 * drift, y: 0.46 + 0.03 * driftY),
                                    startRadius: 14,
                                    endRadius: 320
                                )
                            )
                            .blendMode(.screen)
                        shape
                            .fill(
                                RadialGradient(
                                    colors: [Color(hex: 0xA4B8C8).opacity(0.18 + 0.05 * (1 - pulse)), .clear],
                                    center: UnitPoint(x: 0.86 - 0.03 * drift, y: 0.18 + 0.02 * driftY),
                                    startRadius: 16,
                                    endRadius: 240
                                )
                            )
                            .blendMode(.screen)
                        shape
                            .fill(
                                RadialGradient(
                                    colors: [Color(hex: 0x2C6E93).opacity(0.18 + 0.05 * pulse), .clear],
                                    center: UnitPoint(x: 0.58 + 0.04 * driftY, y: 0.74 - 0.02 * drift),
                                    startRadius: 12,
                                    endRadius: 260
                                )
                            )
                            .blendMode(.screen)
                        shape
                            .fill(
                                LinearGradient(
                                    colors: [
                                        .clear,
                                        Color.white.opacity(0.16),
                                        .clear
                                    ],
                                    startPoint: .leading,
                                    endPoint: .trailing
                                )
                            )
                            .scaleEffect(x: 2.1, y: 1.0)
                            .offset(x: CGFloat(sin(time * 0.11)) * 110)
                            .blur(radius: 24)
                            .opacity(0.28)
                            .mask(shape)
                        shape
                            .fill(
                                LinearGradient(
                                    colors: [
                                        .clear,
                                        Color.white.opacity(0.14),
                                        .clear
                                    ],
                                    startPoint: .leading,
                                    endPoint: .trailing
                                )
                            )
                            .scaleEffect(x: 1.7, y: 1.0)
                            .offset(x: CGFloat(cos(time * 0.09 + 1.7)) * 86, y: CGFloat(sin(time * 0.08)) * 8)
                            .blur(radius: 18)
                            .opacity(0.2)
                            .mask(shape)
                        shape.fill(Color.black.opacity(0.22))
                        shape
                            .fill(
                                LinearGradient(
                                    colors: [
                                        Color.white.opacity(0.13),
                                        Color.white.opacity(0.07),
                                        .clear
                                    ],
                                    startPoint: .top,
                                    endPoint: .center
                                )
                            )
                            .mask(shape)
                        shape.stroke(Color.white.opacity(0.18), lineWidth: 0.8)
                        shape
                            .stroke(Color.black.opacity(0.16), lineWidth: 1.2)
                            .blur(radius: 1.2)
                    }
                }
            )
    }
}
