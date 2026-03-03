import SwiftUI
import Lottie

struct GenerateView: View {
    @Environment(APIClient.self) private var api
    @State private var vm = GenerateViewModel()

    // Whether the glass chat panel is expanded (full-height) or collapsed (bottom bar)
    private var panelExpanded: Bool {
        switch vm.mode {
        case .idle, .chatting: return true
        case .generating, .recipe, .tweaking, .tweakLoading: return false
        }
    }

    var body: some View {
        ZStack {
            AlchemyColors.deepDark.ignoresSafeArea()

            VStack(spacing: 0) {
                AlchemyTopNav(
                    title: vm.activeRecipe?.title,
                    trailingAction: {}
                )
                .padding(.bottom, Spacing.sm)

                // Content area — glass panel overlays recipe
                ZStack(alignment: .bottom) {
                    if let recipe = vm.activeRecipe {
                        recipeScrollView(recipe)
                            .opacity(vm.mode == .tweakLoading ? 0.3 : 1.0)
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
            Color.clear.frame(height: Sizing.tabBarHeight + Spacing.xxxl)
        }
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
                    .padding(.top, Spacing.xl)
                    .padding(.bottom, Spacing.sm)
                }
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
                .padding(.horizontal, Spacing.sm2)
                .padding(.bottom, Spacing.sm2)
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
                .padding(.horizontal, Spacing.sm2)
                .padding(.bottom, Spacing.sm2)

            // Tab bar clearance
            Color.clear.frame(height: Sizing.tabBarHeight + Spacing.xxxl)
        }
        .glassPanelBackground()
        .ignoresSafeArea(.container, edges: .bottom)
    }

    // MARK: - Intro Message

    private var introMessage: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("What would you like to make today?")
                .font(AlchemyFont.chatBody)
                .foregroundStyle(AlchemyColors.textPrimary)
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
        .padding(.horizontal, Spacing.md)
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
            .padding(.top, Spacing.xxxl)
        }
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
        HStack(alignment: .bottom, spacing: 0) {
            TextField(
                "I want some ideas for dinner tonight",
                text: $vm.input,
                axis: .vertical
            )
            .font(AlchemyFont.body)
            .foregroundStyle(AlchemyColors.textPrimary)
            .tint(AlchemyColors.gold)
            .lineLimit(1...4)
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, Spacing.sm2)

            Button {
                Task { await vm.sendMessage(api: api) }
            } label: {
                Image(systemName: "paperplane")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(AlchemyColors.grey4)
                    .frame(width: 32, height: 32)
            }
            .disabled(vm.isLoading || vm.input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .padding(.trailing, Spacing.sm)
            .padding(.bottom, Spacing.xs)
        }
        .frame(height: 56)
        .background(AlchemyColors.dark)
        .clipShape(RoundedRectangle(cornerRadius: Radius.lg))
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
        let borderColor = AlchemyColors.borderStrong
        return Group {
            if #available(iOS 26.0, *) {
                self
                    .glassEffect(
                        .regular.tint(AlchemyColors.dark.opacity(0.3)),
                        in: shape
                    )
                    .overlay(
                        shape.stroke(borderColor.opacity(0.9), lineWidth: 1)
                    )
            } else {
                self
                    .background(AlchemyColors.chatPanelGradient, in: shape)
                    .overlay(
                        shape.stroke(borderColor.opacity(0.9), lineWidth: 1)
                    )
            }
        }
    }
}
