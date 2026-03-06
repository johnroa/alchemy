import SwiftUI
import Lottie

/// Generate screen — the core recipe creation experience.
///
/// State machine flow:
/// 1. `.chatting` — Recipe skeleton in background, chat window floating over bottom 2/3
///    - iMessage-style bubbles, assistant greeting, keyboard defaulted up
///    - User chats until they trigger generation (e.g., "make that" / "let's go")
/// 2. `.generating` — Chat minimizes, keyboard collapses, Lottie animation plays over skeleton
/// 3. `.presenting` — Recipe result loads in-place (same layout as RecipeDetail)
///    - "Add to Cookbook" animates into header
///    - Component tabs appear below header for multi-dish results
///    - Input bar placeholder changes to "Want to make any changes?"
/// 4. `.iterating` — User sends changes via input bar, loops back to generating/presenting
///
/// The chat window is resizable via drag handle — user can pull it up/down.
/// It terminates above the keyboard so the last message is always visible.
struct GenerateView: View {
    @State private var phase: GeneratePhase = .chatting
    @State private var messages: [ChatMessage] = [PreviewData.generateGreeting]
    @State private var inputText = ""
    @State private var chatHeight: CGFloat = 400
    @State private var showAddToCookbook = false
    @State private var activeComponentIndex = 0
    @State private var showPreferences = false
    @State private var showSettings = false

    @Environment(\.dismiss) private var dismiss

    /// Minimum chat panel height — enough for ~3 messages
    private let minChatHeight: CGFloat = 200
    /// Maximum chat panel height — leaves room for skeleton peek
    private let maxChatHeight: CGFloat = 600

    var body: some View {
        NavigationStack {
            ZStack {
                // Background: recipe skeleton or loaded recipe
                backgroundContent

                // Chat overlay (bottom-anchored, resizable)
                if phase == .chatting || phase == .iterating {
                    chatOverlay
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }

                // Lottie loading animation
                if phase == .generating {
                    generationLoader
                        .transition(.opacity)
                }
            }
            .background(AlchemyColors.background)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbarContent }
            .animation(.spring(duration: 0.5, bounce: 0.2), value: phase)
            .sheet(isPresented: $showPreferences) { PreferencesView() }
            .sheet(isPresented: $showSettings) { SettingsView() }
        }
    }

    // MARK: - Background Content

    @ViewBuilder
    private var backgroundContent: some View {
        switch phase {
        case .chatting:
            recipeSkeleton
        case .generating:
            recipeSkeleton
        case .presenting, .iterating:
            presentedRecipe
        }
    }

    // MARK: - Recipe Skeleton

    /// Placeholder skeleton mimicking the recipe detail layout.
    /// Gray blocks for image, title, ingredients, steps — gives the user
    /// a sense of what's coming while they chat.
    private var recipeSkeleton: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: AlchemySpacing.lg) {
                // Image placeholder
                RoundedRectangle(cornerRadius: AlchemySpacing.cardRadius)
                    .fill(AlchemyColors.surfaceSecondary)
                    .frame(height: 200)

                // Title placeholder
                RoundedRectangle(cornerRadius: 4)
                    .fill(AlchemyColors.surfaceSecondary)
                    .frame(width: 200, height: 24)

                // Subtitle placeholder
                RoundedRectangle(cornerRadius: 4)
                    .fill(AlchemyColors.surface)
                    .frame(width: 280, height: 16)

                // Ingredient lines
                ForEach(0..<5, id: \.self) { i in
                    HStack {
                        RoundedRectangle(cornerRadius: 4)
                            .fill(AlchemyColors.surface)
                            .frame(width: CGFloat.random(in: 100...160), height: 14)
                        Spacer()
                        RoundedRectangle(cornerRadius: 4)
                            .fill(AlchemyColors.surface)
                            .frame(width: 50, height: 14)
                    }
                    if i < 4 {
                        Divider().overlay(AlchemyColors.separator)
                    }
                }

                // Step lines
                ForEach(0..<3, id: \.self) { _ in
                    HStack(alignment: .top, spacing: AlchemySpacing.md) {
                        Circle()
                            .fill(AlchemyColors.surface)
                            .frame(width: 28, height: 28)
                        VStack(alignment: .leading, spacing: 6) {
                            RoundedRectangle(cornerRadius: 4)
                                .fill(AlchemyColors.surface)
                                .frame(height: 14)
                            RoundedRectangle(cornerRadius: 4)
                                .fill(AlchemyColors.surface)
                                .frame(width: 200, height: 14)
                        }
                    }
                }
            }
            .padding(.horizontal, AlchemySpacing.screenHorizontal)
            .padding(.top, AlchemySpacing.lg)
            .padding(.bottom, 500) // extra space so skeleton peeks above chat
        }
        .scrollDisabled(true)
        .opacity(0.5)
    }

    // MARK: - Presented Recipe

    /// The generated recipe rendered in-place, same format as RecipeDetail.
    /// Includes component tabs for multi-dish results.
    private var presentedRecipe: some View {
        VStack(spacing: 0) {
            // Component tabs (Main Dish, Side, etc.)
            if PreviewData.sampleComponents.count > 1 {
                componentTabs
            }

            let component = PreviewData.sampleComponents[activeComponentIndex]
            RecipeDetailView(
                recipe: component.recipe,
                showAddToCookbook: false
            )
        }
    }

    /// Horizontal tab strip below the nav bar for multi-component recipe sets.
    /// Each tab represents a component: Main Dish, Side, Appetizer, etc.
    private var componentTabs: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: AlchemySpacing.sm) {
                ForEach(Array(PreviewData.sampleComponents.enumerated()), id: \.element.id) { index, component in
                    Button {
                        withAnimation { activeComponentIndex = index }
                    } label: {
                        Text(component.role)
                            .font(AlchemyTypography.captionBold)
                            .foregroundStyle(
                                index == activeComponentIndex
                                    ? AlchemyColors.accent
                                    : AlchemyColors.textSecondary
                            )
                            .padding(.horizontal, AlchemySpacing.md)
                            .padding(.vertical, AlchemySpacing.sm)
                    }
                    .glassEffect(
                        index == activeComponentIndex ? .regular : .clear,
                        in: .capsule
                    )
                }
            }
            .padding(.horizontal, AlchemySpacing.screenHorizontal)
            .padding(.vertical, AlchemySpacing.sm)
        }
    }

    // MARK: - Chat Overlay

    /// Floating chat panel anchored to the bottom of the screen.
    /// Resizable via drag handle. Contains iMessage-style chat bubbles
    /// and the glass input bar.
    private var chatOverlay: some View {
        VStack(spacing: 0) {
            Spacer()

            VStack(spacing: 0) {
                // Drag handle for resizing
                dragHandle

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
                        .padding(.vertical, AlchemySpacing.sm)
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
                    placeholder: phase == .iterating
                        ? "Want to make any changes?"
                        : "Give me dinner ideas",
                    text: $inputText,
                    onSubmit: sendMessage
                )
                .padding(.bottom, AlchemySpacing.sm)
            }
            .frame(height: chatHeight)
            .background(
                AlchemyColors.background.opacity(0.85)
                    .background(.ultraThinMaterial)
            )
            .clipShape(
                UnevenRoundedRectangle(
                    topLeadingRadius: 20,
                    bottomLeadingRadius: 0,
                    bottomTrailingRadius: 0,
                    topTrailingRadius: 20
                )
            )
            .gesture(chatResizeGesture)
        }
    }

    /// Pill-shaped drag handle at the top of the chat panel
    private var dragHandle: some View {
        RoundedRectangle(cornerRadius: 2)
            .fill(AlchemyColors.textTertiary)
            .frame(width: 36, height: 4)
            .padding(.top, AlchemySpacing.sm)
            .padding(.bottom, AlchemySpacing.xs)
    }

    /// Drag gesture to resize the chat panel between min and max heights
    private var chatResizeGesture: some Gesture {
        DragGesture()
            .onChanged { value in
                let newHeight = chatHeight - value.translation.height
                chatHeight = min(max(newHeight, minChatHeight), maxChatHeight)
            }
    }

    // MARK: - Generation Loader

    /// Lottie animation that plays over the skeleton during recipe generation.
    private var generationLoader: some View {
        VStack {
            Spacer()

            LottieView(animation: .named("alchemy-loading"))
                .playing(loopMode: .loop)
                .frame(width: 160, height: 160)

            Text("Crafting your recipe...")
                .font(AlchemyTypography.bodySecondary)
                .foregroundStyle(AlchemyColors.textSecondary)
                .padding(.top, AlchemySpacing.md)

            Spacer()
        }
    }

    // MARK: - Toolbar

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            HStack(spacing: AlchemySpacing.sm) {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "chevron.left")
                        .foregroundStyle(AlchemyColors.textPrimary)
                }

                if showAddToCookbook {
                    Button {
                        // Will call POST /chat/{id}/commit
                    } label: {
                        Label("Add to Cookbook", systemImage: "bookmark.fill")
                            .font(AlchemyTypography.captionBold)
                            .foregroundStyle(AlchemyColors.accent)
                    }
                    .transition(.scale.combined(with: .opacity))
                }
            }
        }

        ToolbarItem(placement: .topBarTrailing) {
            ProfileMenu(
                onPreferences: { showPreferences = true },
                onSettings: { showSettings = true }
            )
        }
    }

    // MARK: - Actions

    private func sendMessage() {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        let userMsg = ChatMessage(
            id: UUID().uuidString,
            role: .user,
            content: text,
            createdAt: .now
        )
        messages.append(userMsg)
        inputText = ""

        // Simulate generation after a few chat turns
        let shouldGenerate = messages.filter { $0.role == .user }.count >= 2

        Task {
            // Simulate assistant thinking
            try? await Task.sleep(for: .seconds(1))

            if shouldGenerate && phase == .chatting {
                // Assistant confirms and triggers generation
                let reply = ChatMessage(
                    id: UUID().uuidString,
                    role: .assistant,
                    content: "That sounds delicious! Let me put that together for you.",
                    createdAt: .now
                )
                messages.append(reply)

                try? await Task.sleep(for: .seconds(0.8))

                // Transition to generating: chat minimizes, loader appears
                phase = .generating

                // Simulate generation time
                try? await Task.sleep(for: .seconds(3))

                // Present the result
                phase = .presenting
                withAnimation(.spring(duration: 0.4)) {
                    showAddToCookbook = true
                }
            } else {
                // Normal assistant reply
                let reply = ChatMessage(
                    id: UUID().uuidString,
                    role: .assistant,
                    content: "Great idea! Tell me more — any specific ingredients, cuisine style, or dietary needs?",
                    createdAt: .now
                )
                messages.append(reply)
            }
        }
    }
}

/// The discrete states of the generate screen.
/// Transitions between these drive all visual changes.
enum GeneratePhase: Equatable {
    /// User is chatting with assistant, skeleton visible behind
    case chatting
    /// Generation in progress, Lottie animation playing
    case generating
    /// Recipe result is displayed, user can review
    case presenting
    /// User is tweaking the presented recipe via chat
    case iterating
}
