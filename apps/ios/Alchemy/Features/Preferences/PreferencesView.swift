import SwiftUI

/// Preferences is intentionally split into three layers so the user can tell,
/// at a glance, what they can change directly versus what the Sous Chef learns
/// and manages conversationally. The embedded chat dock keeps that AI-managed
/// editing loop inside this screen instead of bouncing the user into the main
/// recipe generation tab and losing context.
struct PreferencesView: View {
    @Environment(\.dismiss) private var dismiss

    /// Kept for call-site compatibility. Preference editing now happens inline
    /// on this screen instead of switching tabs.
    var selectedTab: Binding<AppTab>?

    @State private var profile = PreferenceProfile()
    @State private var isLoading = true
    @State private var isSaving = false
    @State private var errorMessage: String?

    @State private var skillLevel = "Home Cook"
    @State private var defaultServings = 2
    @State private var maxDifficulty = 0.5

    @State private var measurementSystem = "imperial"
    @State private var temperatureUnit = "fahrenheit"
    @State private var ingredientGrouping = "component"
    @State private var inlineMeasurements = true
    @State private var instructionVerbosity = "balanced"

    @State private var activeIntent: PreferenceEditingIntent?
    @State private var chatMessages: [ChatMessage] = []
    @State private var chatInput = ""
    @State private var chatSessionId: String?
    @State private var isChatExpanded = false
    @State private var isChatSending = false
    @FocusState private var isChatInputFocused: Bool
    @FocusState private var isFormFieldFocused: Bool

    /// Tracks which preference values are in "delete mode" after long-press.
    /// Key is "\(intent.key):\(value)" to uniquely identify each chip.
    @State private var deletableChips: Set<String> = []

    /// Brief toast text shown when the Sous Chef saves a preference update.
    /// Auto-dismissed after 2.5 seconds.
    @State private var savedToastText: String?

    private static let skillLevelMap: [(api: String, display: String)] = [
        ("beginner", "Beginner"),
        ("intermediate", "Home Cook"),
        ("advanced", "Experienced"),
        ("professional", "Professional"),
    ]

    private static let measurementOptions: [(label: String, value: String)] = [
        ("U.S.", "imperial"),
        ("Metric", "metric"),
    ]

    private static let temperatureOptions: [(label: String, value: String)] = [
        ("Fahrenheit", "fahrenheit"),
        ("Celsius", "celsius"),
    ]

    private static let groupingOptions: [(label: String, value: String)] = [
        ("By Component", "component"),
        ("By Category", "category"),
        ("Flat List", "flat"),
    ]

    private static let verbosityOptions: [(label: String, value: String)] = [
        ("Concise", "concise"),
        ("Balanced", "balanced"),
        ("Detailed", "detailed"),
    ]

    private let skillLevels = skillLevelMap.map(\.display)
    private let minimizedChatHeight: CGFloat = 170

    var body: some View {
        NavigationStack {
            GeometryReader { proxy in
                ZStack(alignment: .bottom) {
                    AlchemyColors.background.ignoresSafeArea()

                    Group {
                        if isLoading {
                            AlchemyLoadingIndicator()
                                .frame(maxWidth: .infinity, maxHeight: .infinity)
                        } else {
                            preferencesForm(bottomInset: minimizedChatHeight + 24)
                                .allowsHitTesting(!isChatExpanded)
                        }
                    }

                    if !isFormFieldFocused {
                        preferenceChatDock(in: proxy)
                    }

                    // Toast overlay — appears at the top when preferences are saved
                    if let toastText = savedToastText {
                        VStack {
                            HStack(spacing: 6) {
                                Image(systemName: "checkmark.circle.fill")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(.green)
                                Text(toastText)
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(.white)
                            }
                            .padding(.horizontal, 16)
                            .padding(.vertical, 10)
                            .background(.ultraThinMaterial, in: Capsule())
                            .shadow(color: .black.opacity(0.2), radius: 12, y: 4)
                            .transition(.move(edge: .top).combined(with: .opacity))

                            Spacer()
                        }
                        .padding(.top, 8)
                    }
                }
            }
            .navigationTitle("Preferences")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView()
                    } else {
                        Button("Save") {
                            Task { await savePreferences() }
                        }
                    }
                }
            }
            .task { await loadPreferences() }
        }
        .tint(.white)
    }


    private func preferencesForm(bottomInset: CGFloat) -> some View {
        Form {
            quickSettingsSection
            displaySettingsSection

            Section {
                sousChefHero
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)

                ForEach(preferenceCards) { card in
                    preferenceRow(card)
                }
            }

            if let freeForm = profile.freeForm, !freeForm.isEmpty {
                Section("Notes from Sous Chef") {
                    Text(freeForm)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }

            if let errorMessage {
                Section {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Color.black)
        .scrollDismissesKeyboard(.immediately)
        .safeAreaInset(edge: .bottom) {
            Color.clear.frame(height: bottomInset)
        }
    }

    private var quickSettingsSection: some View {
        Section {
            Picker("Skill Level", selection: $skillLevel) {
                ForEach(skillLevels, id: \.self) { Text($0) }
            }

            Stepper(value: $defaultServings, in: 1...12) {
                HStack {
                    Text("Default Servings")
                    Spacer()
                    Text("\(defaultServings)")
                        .foregroundStyle(.secondary)
                }
            }

            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Max Difficulty")
                    Spacer()
                    Text(difficultyLabel)
                        .foregroundStyle(.secondary)
                }
                Slider(value: $maxDifficulty, in: 0...1, step: 0.25)
                    .tint(.white)
            }
        } header: {
            Label("Your Settings", systemImage: "slider.horizontal.3")
        }
    }

    private var displaySettingsSection: some View {
        Section {
            Picker("Measurement System", selection: $measurementSystem) {
                ForEach(Self.measurementOptions, id: \.value) { option in
                    Text(option.label).tag(option.value)
                }
            }

            Picker("Temperature Units", selection: $temperatureUnit) {
                ForEach(Self.temperatureOptions, id: \.value) { option in
                    Text(option.label).tag(option.value)
                }
            }

            Picker("Ingredient Grouping", selection: $ingredientGrouping) {
                ForEach(Self.groupingOptions, id: \.value) { option in
                    Text(option.label).tag(option.value)
                }
            }

            Toggle("Inline Measurements", isOn: $inlineMeasurements)
                .tint(Color(white: 0.45))

            Picker("Instruction Detail", selection: $instructionVerbosity) {
                ForEach(Self.verbosityOptions, id: \.value) { option in
                    Text(option.label).tag(option.value)
                }
            }
        } header: {
            Label("Recipe Format", systemImage: "text.alignleft")
        } footer: {
            Text("Controls how recipes appear — doesn't change what Sous Chef recommends.")
        }
    }

    /// Rounded hero with a soft pastel AI gradient and dark sans-serif text.
    private var sousChefHero: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Image(systemName: "wand.and.sparkles")
                    .font(.system(size: 18, weight: .semibold))
                Text("Sous Chef Profile")
                    .font(.system(size: 20, weight: .bold, design: .default))
            }

            Text("Learned through conversation. Tap any category to refine with your Sous Chef.")
                .font(.system(size: 14, weight: .regular, design: .default))
                .opacity(0.6)
        }
        .foregroundStyle(Color(red: 0.10, green: 0.10, blue: 0.12))
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 18)
        .padding(.vertical, 16)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [
                            Color(red: 0.82, green: 0.88, blue: 0.98),
                            Color(red: 0.88, green: 0.82, blue: 0.95),
                            Color(red: 0.80, green: 0.92, blue: 0.92),
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
        )
        .padding(.horizontal, 4)
        .padding(.vertical, 4)
    }

    /// Each AI-managed preference row. Title + value chips (or dim helper
    /// text when empty) + sparkle AI icon. Values render as bright white
    /// pill chips; long-press any chip to reveal an X for deletion.
    private func preferenceRow(_ intent: PreferenceEditingIntent) -> some View {
        let values = cardValues(for: intent)

        return Button {
            openPreferenceEditor(for: intent)
        } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: intent.systemImage)
                    .font(.title3)
                    .foregroundStyle(.white)
                    .frame(width: 28, height: 28)

                VStack(alignment: .leading, spacing: 6) {
                    Text(intent.title)
                        .font(.headline)
                        .foregroundStyle(.white)

                    if values.isEmpty {
                        Text(intent.summary)
                            .font(.caption)
                            .foregroundStyle(.white.opacity(0.25))
                            .lineLimit(2)
                    } else {
                        preferenceChips(values, intentKey: intent.key)
                    }
                }

                Spacer(minLength: 4)

                Image(systemName: "sparkles")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.white.opacity(0.4))
                    .padding(.top, 4)
            }
        }
        .listRowBackground(Color.clear)
    }

    /// Flow-wrapped bright white pill chips for preference values.
    /// Long-press toggles a delete X; tapping X removes the value.
    private func preferenceChips(_ values: [String], intentKey: String) -> some View {
        FlowLayout(spacing: 6) {
            ForEach(values, id: \.self) { value in
                let chipId = "\(intentKey):\(value)"
                let isDeleting = deletableChips.contains(chipId)

                HStack(spacing: 4) {
                    Text(value)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.black)

                    if isDeleting {
                        Button {
                            withAnimation(.spring(duration: 0.25)) {
                                deletableChips.remove(chipId)
                            }
                            removePreferenceValue(value, from: intentKey)
                        } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 9, weight: .bold))
                                .foregroundStyle(.black.opacity(0.5))
                        }
                        .buttonStyle(.plain)
                        .transition(.scale.combined(with: .opacity))
                    }
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(
                    Capsule(style: .continuous)
                        .fill(.white)
                )
                .onLongPressGesture {
                    withAnimation(.spring(duration: 0.25)) {
                        if isDeleting {
                            deletableChips.remove(chipId)
                        } else {
                            deletableChips.insert(chipId)
                        }
                    }
                }
            }
        }
    }

    private var preferenceCards: [PreferenceEditingIntent] {
        [
            .init(
                key: "dietary_restrictions",
                title: "Dietary Restrictions",
                prompt: "Tell me about your dietary restrictions so I can personalize your recipes safely.",
                summary: "Allergies, intolerances, hard boundaries.",
                propagation: .retroactive,
                systemImage: "exclamationmark.shield"
            ),
            .init(
                key: "dietary_preferences",
                title: "Dietary Preferences",
                prompt: "Tell me about the dietary styles you prefer me to favor going forward.",
                summary: "Vegetarian leaning, high-protein, low-sugar, and similar preferences.",
                propagation: .forwardOnly,
                systemImage: "leaf"
            ),
            .init(
                key: "equipment",
                title: "Equipment & Kitchen Setup",
                prompt: "Tell me about your kitchen setup, oven, stove, and any special equipment you use.",
                summary: "Appliances, cookware, powerful ovens, and kitchen constraints.",
                propagation: .retroactive,
                systemImage: "frying.pan"
            ),
            .init(
                key: "aversions",
                title: "Ingredients To Avoid",
                prompt: "Tell me which ingredients or flavors you want me to avoid in your recipes.",
                summary: "Aversions, hated ingredients, or recurring no-go items.",
                propagation: .retroactive,
                systemImage: "hand.thumbsdown"
            ),
            .init(
                key: "cuisines",
                title: "Favorite Cuisines",
                prompt: "Tell me which cuisines, regional styles, or flavor worlds you want more of.",
                summary: "The cuisines you love and want more often.",
                propagation: .forwardOnly,
                systemImage: "globe"
            ),
            .init(
                key: "pantry_staples",
                title: "Pantry Staples",
                prompt: "Tell me about ingredients you usually keep on hand so I can lean on them.",
                summary: "Default pantry items and go-to staples.",
                propagation: .forwardOnly,
                systemImage: "bag"
            ),
            .init(
                key: "health_goals",
                title: "Health Goals",
                prompt: "Tell me about any nutrition or health goals I should keep in mind.",
                summary: "Protein, fiber, sodium, sugar, and other health targets.",
                propagation: .forwardOnly,
                systemImage: "heart.text.square"
            ),
            .init(
                key: "spice_tolerance",
                title: "Spice Tolerance",
                prompt: "Tell me how much heat you enjoy and when I should tone it up or down.",
                summary: "Comfort level with spicy food and heat preferences.",
                propagation: .forwardOnly,
                systemImage: "flame"
            ),
            .init(
                key: "cooking_style",
                title: "Cooking Habits",
                prompt: "Tell me about your cooking habits, time pressure, budget, and household routine.",
                summary: "Weeknight pace, budget, time limits, and how you cook day to day.",
                propagation: .forwardOnly,
                systemImage: "clock"
            ),
            .init(
                key: "household_detail",
                title: "Household & Dining",
                prompt: "Tell me about who you cook for — do you eat together as a family every night, is it usually just you and a partner, do you meal-prep for the week? Any household context helps me personalize portions and recipes.",
                summary: "Who you cook for, family meals, meal-prep habits.",
                propagation: .forwardOnly,
                systemImage: "person.2"
            ),
        ]
    }


    /// Removes a single value from the appropriate preference list and persists.
    private func removePreferenceValue(_ value: String, from intentKey: String) {
        switch intentKey {
        case "dietary_restrictions":
            profile.dietaryRestrictions?.removeAll { $0 == value }
        case "dietary_preferences":
            profile.dietaryPreferences?.removeAll { $0 == value }
        case "equipment":
            profile.equipment?.removeAll { $0 == value }
            removeExtendedValue(value, key: "kitchen_environment")
        case "aversions":
            profile.aversions?.removeAll { $0 == value }
        case "cuisines":
            profile.cuisines?.removeAll { $0 == value }
        case "pantry_staples", "health_goals", "spice_tolerance", "cooking_style",
             "household_detail":
            removeExtendedValue(value, key: intentKey)
        default:
            break
        }

        Task { await savePreferenceRemoval() }
    }

    private func removeExtendedValue(_ value: String, key: String) {
        guard var entry = profile.extendedPreferences?[key] else { return }
        entry.values.removeAll { $0 == value }
        if entry.values.isEmpty {
            profile.extendedPreferences?.removeValue(forKey: key)
        } else {
            profile.extendedPreferences?[key] = entry
        }
    }

    /// Persists profile after a value removal without touching the
    /// display/quick-settings fields — sends only AI-managed lists.
    @MainActor
    private func savePreferenceRemoval() async {
        let updated = PreferenceProfile(
            dietaryPreferences: profile.dietaryPreferences,
            dietaryRestrictions: profile.dietaryRestrictions,
            skillLevel: nil,
            equipment: profile.equipment,
            cuisines: profile.cuisines,
            aversions: profile.aversions,
            cookingFor: nil,
            maxDifficulty: nil,
            freeForm: nil,
            extendedPreferences: profile.extendedPreferences,
            presentationPreferences: nil
        )

        do {
            let response: PreferenceProfile = try await APIClient.shared.request(
                "/preferences",
                method: .patch,
                body: updated
            )
            profile = response
            populateEditableState(from: response)
        } catch {
            print("[PreferencesView] removal save failed: \(error)")
        }
    }


    /// Holographic mesh gradient matching the Sous Chef chat panel in
    /// GenerateView. Same pastel palette so the two surfaces feel unified.
    private var chatMeshBackground: some View {
        MeshGradient(
            width: 3,
            height: 3,
            points: [
                SIMD2(0.0, 0.0), SIMD2(0.5, 0.0), SIMD2(1.0, 0.0),
                SIMD2(0.0, 0.5), SIMD2(0.6, 0.45), SIMD2(1.0, 0.5),
                SIMD2(0.0, 1.0), SIMD2(0.5, 1.0), SIMD2(1.0, 1.0),
            ],
            colors: [
                Color(red: 0.88, green: 0.85, blue: 0.95),
                Color(red: 0.82, green: 0.92, blue: 0.96),
                Color(red: 0.90, green: 0.88, blue: 0.96),
                Color(red: 0.85, green: 0.94, blue: 0.90),
                Color(red: 0.95, green: 0.86, blue: 0.90),
                Color(red: 0.84, green: 0.90, blue: 0.97),
                Color(red: 0.92, green: 0.88, blue: 0.94),
                Color(red: 0.86, green: 0.95, blue: 0.94),
                Color(red: 0.90, green: 0.86, blue: 0.93),
            ],
            smoothsColors: true
        )
        .opacity(0.95)
    }

    /// Two strict states only:
    /// - **Minimized**: Shows the full last assistant message. Tapping
    ///   anywhere on the dock expands it. No input bar, no keyboard.
    /// - **Expanded**: Full chat history + input bar + keyboard raised.
    ///   Chevron in top-right to minimize.
    ///
    /// After sending a message the chat stays expanded so the user can
    /// continue the conversation. The agent confirms when it has enough
    /// info and the user can then minimize manually.
    private func preferenceChatDock(in proxy: GeometryProxy) -> some View {
        let expandedHeight = max(360, min(proxy.size.height * 0.65, 560))
        let currentHeight = isChatExpanded ? expandedHeight : minimizedChatHeight

        return VStack(spacing: 0) {
            if isChatExpanded {
                // Expanded: chevron to minimize + full conversation + input bar
                HStack {
                    Spacer()
                    Button {
                        withAnimation(.spring(duration: 0.45, bounce: 0.15)) {
                            isChatExpanded = false
                            isChatInputFocused = false
                        }
                    } label: {
                        Image(systemName: "chevron.down.circle.fill")
                            .font(.title3)
                            .foregroundStyle(Color(red: 0.3, green: 0.3, blue: 0.35).opacity(0.6))
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 16)
                .padding(.top, 10)
                .padding(.bottom, 4)

                ScrollViewReader { reader in
                    ScrollView {
                        LazyVStack(spacing: AlchemySpacing.sm) {
                            ForEach(chatMessages) { message in
                                ChatBubble(message: message)
                                    .id(message.id)
                            }
                        }
                        .padding(.horizontal, AlchemySpacing.screenHorizontal)
                        .padding(.top, AlchemySpacing.sm)
                        .padding(.bottom, AlchemySpacing.xxl)
                    }
                    .scrollDismissesKeyboard(.interactively)
                    .onTapGesture { isChatInputFocused = false }
                    .onChange(of: chatMessages.count) { _, _ in
                        guard let lastId = chatMessages.last?.id else { return }
                        withAnimation(.easeOut(duration: 0.2)) {
                            reader.scrollTo(lastId, anchor: .bottom)
                        }
                    }
                }

                chatInputBar
                    .padding(.top, AlchemySpacing.xs)
                    .padding(.bottom, 8)
            } else {
                // Minimized: chevron-up + last assistant message + fake
                // input placeholder. No real TextField so the keyboard
                // can never appear in this state. Tapping the placeholder
                // or the chevron expands the dock and raises the keyboard.
                HStack {
                    Spacer()
                    Button { expandChat() } label: {
                        Image(systemName: "chevron.up.circle.fill")
                            .font(.title3)
                            .foregroundStyle(Color(red: 0.3, green: 0.3, blue: 0.35).opacity(0.6))
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 2)

                if let last = chatMessages.last(where: { $0.role == .assistant && !$0.isLoading }) {
                    ChatBubble(message: last)
                        .padding(.horizontal, AlchemySpacing.screenHorizontal)
                }

                HStack(spacing: AlchemySpacing.sm) {
                    Text("Tell your Sous Chef…")
                        .font(AlchemyTypography.chatPlaceholder)
                        .foregroundStyle(Color(red: 0.35, green: 0.35, blue: 0.40))
                    Spacer()
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.title2)
                        .foregroundStyle(Color(red: 0.3, green: 0.3, blue: 0.35).opacity(0.4))
                }
                .padding(.horizontal, AlchemySpacing.lg)
                .padding(.vertical, AlchemySpacing.md)
                .background {
                    ZStack {
                        RoundedRectangle(cornerRadius: 24, style: .continuous)
                            .fill(.white.opacity(0.35))
                            .blur(radius: 16)
                        RoundedRectangle(cornerRadius: 24, style: .continuous)
                            .fill(.white.opacity(0.25))
                            .overlay(
                                RoundedRectangle(cornerRadius: 24, style: .continuous)
                                    .fill(.ultraThinMaterial.opacity(0.5))
                            )
                        RoundedRectangle(cornerRadius: 24, style: .continuous)
                            .strokeBorder(.white.opacity(0.4), lineWidth: 0.5)
                    }
                }
                .padding(.horizontal, AlchemySpacing.screenHorizontal)
                .padding(.top, 4)
                .contentShape(Rectangle())
                .onTapGesture { expandChat() }
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: currentHeight, alignment: .top)
        .background(
            UnevenRoundedRectangle(
                topLeadingRadius: 20,
                bottomLeadingRadius: 0,
                bottomTrailingRadius: 0,
                topTrailingRadius: 20
            )
            .fill(.ultraThinMaterial)
            .overlay {
                chatMeshBackground
                    .clipShape(
                        UnevenRoundedRectangle(
                            topLeadingRadius: 20,
                            bottomLeadingRadius: 0,
                            bottomTrailingRadius: 0,
                            topTrailingRadius: 20
                        )
                    )
            }
            .ignoresSafeArea(edges: .bottom)
        )
        .animation(.spring(duration: 0.45, bounce: 0.15), value: isChatExpanded)
    }

    /// Input bar styled identically to GenerateView's chatInputBar: frosted
    /// white glass pill with dark text and a subtle stroke border.
    private var chatInputBar: some View {
        HStack(spacing: AlchemySpacing.sm) {
            TextField(
                "",
                text: $chatInput,
                prompt: Text("Tell your Sous Chef…")
                    .foregroundStyle(Color(red: 0.35, green: 0.35, blue: 0.40)),
                axis: .vertical
            )
            .lineLimit(1...3)
            .submitLabel(.return)
            .font(AlchemyTypography.chatPlaceholder)
            .foregroundStyle(Color(red: 0.15, green: 0.15, blue: 0.18))
            .tint(Color(red: 0.2, green: 0.2, blue: 0.25))
            .focused($isChatInputFocused)
            .fixedSize(horizontal: false, vertical: true)
            .disabled(isChatSending)
            .onSubmit {
                Task { await sendChatMessage() }
            }

            if isChatSending {
                ProgressView()
                    .tint(Color(red: 0.3, green: 0.3, blue: 0.35))
            } else {
                Button {
                    Task { await sendChatMessage() }
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.title2)
                        .foregroundStyle(
                            chatInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                ? Color(red: 0.3, green: 0.3, blue: 0.35).opacity(0.4)
                                : Color(red: 0.3, green: 0.3, blue: 0.35)
                        )
                }
                .disabled(chatInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isChatSending)
            }
        }
        .submitScope()
        .padding(.horizontal, AlchemySpacing.lg)
        .padding(.vertical, AlchemySpacing.md)
        .background {
            ZStack {
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .fill(.white.opacity(0.35))
                    .blur(radius: 16)
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .fill(.white.opacity(0.25))
                    .overlay(
                        RoundedRectangle(cornerRadius: 24, style: .continuous)
                            .fill(.ultraThinMaterial.opacity(0.5))
                    )
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .strokeBorder(.white.opacity(0.4), lineWidth: 0.5)
            }
        }
        .padding(.horizontal, AlchemySpacing.screenHorizontal)
        .animation(.easeInOut(duration: 0.2), value: chatInput)
    }


    private var difficultyLabel: String {
        switch maxDifficulty {
        case ..<0.2: "Easy"
        case ..<0.4: "Medium"
        case ..<0.6: "Moderate"
        case ..<0.8: "Hard"
        default: "Expert"
        }
    }

    /// Smoothly expand the chat dock and focus the input after the
    /// animation settles. Factored out so both the chevron button and
    /// the fake input placeholder can share the same behavior.
    private func expandChat() {
        withAnimation(.spring(duration: 0.45, bounce: 0.15)) {
            isChatExpanded = true
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            isChatInputFocused = true
        }
    }

    private func openPreferenceEditor(for intent: PreferenceEditingIntent) {
        activeIntent = intent
        chatSessionId = nil
        chatInput = ""
        chatMessages = [
            ChatMessage(
                id: UUID().uuidString,
                role: .assistant,
                content: intent.prompt,
                createdAt: .now
            )
        ]
        withAnimation(.spring(response: 0.32, dampingFraction: 0.9)) {
            isChatExpanded = true
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            isChatInputFocused = true
        }
    }

    private func cardValues(for intent: PreferenceEditingIntent) -> [String] {
        switch intent.key {
        case "dietary_restrictions":
            return profile.dietaryRestrictions ?? []
        case "dietary_preferences":
            return profile.dietaryPreferences ?? []
        case "equipment":
            return combinedValues(["equipment"], extraKeys: ["kitchen_environment"])
        case "aversions":
            return profile.aversions ?? []
        case "cuisines":
            return profile.cuisines ?? []
        case "pantry_staples":
            return extendedValues("pantry_staples")
        case "health_goals":
            return extendedValues("health_goals")
        case "spice_tolerance":
            return extendedValues("spice_tolerance")
        case "cooking_style":
            return combinedValues([], extraKeys: ["cooking_style", "time_budget", "budget"])
        case "household_detail":
            return combinedValues([], extraKeys: ["household_detail"])
        default:
            return []
        }
    }

    private func combinedValues(_ topLevelKeys: [String], extraKeys: [String]) -> [String] {
        var values: [String] = []

        for key in topLevelKeys {
            switch key {
            case "equipment":
                values.append(contentsOf: profile.equipment ?? [])
            default:
                break
            }
        }

        for key in extraKeys {
            values.append(contentsOf: extendedValues(key))
        }

        var seen = Set<String>()
        return values.filter { value in
            let normalized = value.lowercased()
            guard !seen.contains(normalized) else { return false }
            seen.insert(normalized)
            return true
        }
    }

    private func extendedValues(_ key: String) -> [String] {
        guard let entry = profile.extendedPreferences?[key] else {
            return []
        }
        return entry.values
    }

    private func presentationString(_ key: String) -> String? {
        profile.presentationPreferences?[key]?.stringValue
    }

    private func presentationBool(_ key: String) -> Bool? {
        profile.presentationPreferences?[key]?.boolValue
    }

    private static let sousChefGreeting = "I'm your Sous Chef — tell me about your cooking and I'll shape every recipe to fit."

    @MainActor
    private func loadPreferences() async {
        isLoading = true
        defer { isLoading = false }

        do {
            let loaded: PreferenceProfile = try await APIClient.shared.request("/preferences")
            profile = loaded
            populateEditableState(from: loaded)

            // Debug: trace exactly what the API returned so we can
            // diagnose "Not set" if values are missing from cards.
            print("[PreferencesView] loaded — restrictions: \(loaded.dietaryRestrictions ?? []), prefs: \(loaded.dietaryPreferences ?? []), equipment: \(loaded.equipment ?? []), cuisines: \(loaded.cuisines ?? []), aversions: \(loaded.aversions ?? []), extended: \(loaded.extendedPreferences?.keys.sorted() ?? [])")

            if chatMessages.isEmpty {
                chatMessages = [
                    ChatMessage(
                        id: UUID().uuidString,
                        role: .assistant,
                        content: Self.sousChefGreeting,
                        createdAt: .now
                    )
                ]
            }
        } catch {
            errorMessage = "Couldn't load preferences."
            print("[PreferencesView] load failed: \(error)")
        }
    }

    @MainActor
    private func savePreferences() async {
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }

        let apiSkillLevel = Self.skillLevelMap.first { $0.display == skillLevel }?.api ?? "intermediate"
        let apiMaxDifficulty = round(maxDifficulty * 4.0) + 1.0

        let updated = PreferenceProfile(
            dietaryPreferences: nil,
            dietaryRestrictions: nil,
            skillLevel: apiSkillLevel,
            equipment: nil,
            cuisines: nil,
            aversions: nil,
            cookingFor: "\(defaultServings)",
            maxDifficulty: apiMaxDifficulty,
            freeForm: nil,
            extendedPreferences: nil,
            presentationPreferences: [
                "recipe_units": .string(measurementSystem),
                "recipe_group_by": .string(ingredientGrouping),
                "recipe_inline_measurements": .bool(inlineMeasurements),
                "recipe_temperature_unit": .string(temperatureUnit),
                "recipe_instruction_verbosity": .string(instructionVerbosity),
            ]
        )

        do {
            let response: PreferenceProfile = try await APIClient.shared.request(
                "/preferences",
                method: .patch,
                body: updated
            )
            profile = response
            populateEditableState(from: response)
        } catch {
            errorMessage = "Failed to save. Please try again."
            print("[PreferencesView] save failed: \(error)")
        }
    }

    @MainActor
    private func sendChatMessage() async {
        let trimmed = chatInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isChatSending else { return }

        // Use the active intent if the user tapped a specific card, otherwise
        // fall back to a general preference editing intent so freeform chat works.
        let effectiveIntent = activeIntent ?? PreferenceEditingIntent(
            key: "general",
            title: "Your Cooking Profile",
            prompt: "Tell me anything about your cooking — preferences, skills, equipment, allergies, or interests.",
            summary: "General cooking preferences and profile.",
            propagation: .forwardOnly,
            systemImage: "person.text.rectangle"
        )

        isChatSending = true
        errorMessage = nil
        chatInput = ""

        chatMessages.append(
            ChatMessage(id: UUID().uuidString, role: .user, content: trimmed, createdAt: .now)
        )
        let loadingId = UUID().uuidString
        chatMessages.append(
            ChatMessage(id: loadingId, role: .assistant, content: "", createdAt: .now, isLoading: true)
        )

        do {
            let requestBody: ChatMessageRequest
            let response: ChatSessionResponse

            if let chatSessionId {
                requestBody = ChatMessageRequest(message: trimmed)
                response = try await APIClient.shared.request(
                    "/chat/\(chatSessionId)/messages",
                    method: .post,
                    body: requestBody
                )
            } else {
                requestBody = ChatMessageRequest(
                    message: trimmed,
                    launchContext: ChatLaunchContext(
                        workflow: "preferences",
                        entrySurface: "preferences_screen",
                        preferenceEditingIntent: effectiveIntent
                    )
                )
                response = try await APIClient.shared.request(
                    "/chat",
                    method: .post,
                    body: requestBody
                )
                chatSessionId = response.id
            }

            // The server only stores DB messages (user + assistant turns).
            // The opening prompt added by openPreferenceEditor is local-only,
            // so we prepend it to keep the conversation visually intact.
            let serverMessages: [ChatMessage] = response.messages.compactMap { message in
                guard let role = MessageRole(rawValue: message.role) else { return nil }
                return ChatMessage(
                    id: message.id,
                    role: role,
                    content: message.content,
                    createdAt: .now
                )
            }

            if let intentPrompt = chatMessages.first,
               intentPrompt.role == .assistant,
               !serverMessages.contains(where: { $0.id == intentPrompt.id }) {
                chatMessages = [intentPrompt] + serverMessages
            } else {
                chatMessages = serverMessages
            }

            if let updates = response.responseContext?.preferenceUpdates, !updates.isEmpty {
                let fields = updates.map(\.field).joined(separator: ", ")
                let label = fields.isEmpty ? "Preferences saved" : "Updated \(fields)"

                chatMessages.append(
                    ChatMessage(
                        id: UUID().uuidString,
                        role: .system,
                        content: label,
                        createdAt: .now
                    )
                )

                // Show toast and immediately reload so cards update in place
                withAnimation(.spring(duration: 0.35)) {
                    savedToastText = label
                }
                await loadPreferences()

                // Auto-dismiss the toast after 2.5 seconds
                Task { @MainActor in
                    try? await Task.sleep(for: .seconds(2.5))
                    withAnimation(.easeOut(duration: 0.3)) {
                        savedToastText = nil
                    }
                }
            }
        } catch {
            chatMessages.removeAll { $0.id == loadingId }
            errorMessage = "Couldn't reach your Sous Chef. Please try again."
            print("[PreferencesView] preference chat failed: \(error)")
        }

        isChatSending = false
    }

    private func populateEditableState(from loaded: PreferenceProfile) {
        let apiSkill = (loaded.skillLevel ?? "intermediate").lowercased()
        skillLevel = Self.skillLevelMap.first { $0.api == apiSkill }?.display ?? "Home Cook"
        defaultServings = Int(loaded.cookingFor ?? "") ?? 2

        let rawDifficulty = loaded.maxDifficulty ?? 3.0
        maxDifficulty = rawDifficulty <= 1.0 ? rawDifficulty : min(rawDifficulty / 5.0, 1.0)

        measurementSystem = presentationString("recipe_units") ?? "imperial"
        ingredientGrouping = presentationString("recipe_group_by") ?? "component"
        inlineMeasurements = presentationBool("recipe_inline_measurements") ?? true
        temperatureUnit = presentationString("recipe_temperature_unit") ?? "fahrenheit"
        instructionVerbosity = presentationString("recipe_instruction_verbosity") ?? "balanced"
    }
}

/// Horizontal flow layout that wraps children to the next line when
/// they exceed the available width. Used for preference value chips.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = arrange(proposal: proposal, subviews: subviews)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrange(proposal: proposal, subviews: subviews)
        for (index, position) in result.positions.enumerated() {
            subviews[index].place(
                at: CGPoint(x: bounds.minX + position.x, y: bounds.minY + position.y),
                proposal: .unspecified
            )
        }
    }

    private func arrange(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, positions: [CGPoint]) {
        let maxWidth = proposal.width ?? .infinity
        var positions: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var totalWidth: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > maxWidth && x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            positions.append(CGPoint(x: x, y: y))
            rowHeight = max(rowHeight, size.height)
            x += size.width + spacing
            totalWidth = max(totalWidth, x - spacing)
        }

        return (CGSize(width: totalWidth, height: y + rowHeight), positions)
    }
}

