import SwiftUI
import NukeUI

/// Cookbook screen — saved recipes displayed in a staggered masonry 2-column grid.
///
/// Data source: GET /recipes/cookbook. Falls back to empty state when no
/// recipes are saved. Supports pull-to-refresh, intelligent horizontal
/// filter chips (derived from actual cookbook content), and text search.
struct CookbookView: View {
    @State private var previews: [CookbookEntryItem] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var selectedPreview: CookbookEntryItem?
    @State private var navigateToRecipeId: String?
    @State private var showPreferences = false
    @State private var showSettings = false
    @State private var searchText = ""
    @State private var showFullScreenPreview = false

    // MARK: - Smart Filter State

    /// Currently selected filter chip. nil = "All".
    @State private var activeFilter: CookbookChip?

    /// Intelligently derived filter chips from actual cookbook content.
    /// Recomputed whenever `previews` changes. Ranked by usefulness:
    /// chips that create meaningful subsets (not too broad, not too few)
    /// are surfaced first.
    private var smartChips: [CookbookChip] {
        CookbookChip.generate(from: previews)
    }

    /// Filtered previews based on the active chip and search text.
    private var filteredPreviews: [CookbookEntryItem] {
        previews.filter { entry in
            let matchesSearch = searchText.isEmpty
                || entry.title.localizedCaseInsensitiveContains(searchText)
                || entry.summary.localizedCaseInsensitiveContains(searchText)

            let matchesChip = activeFilter?.matches(entry) ?? true

            return matchesSearch && matchesChip
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                headerBar

                if isLoading && previews.isEmpty {
                    Spacer()
                    ProgressView()
                        .tint(.white)
                    Spacer()
                } else if let errorMessage, previews.isEmpty {
                    Spacer()
                    errorView(errorMessage)
                    Spacer()
                } else if previews.isEmpty {
                    Spacer()
                    emptyView
                    Spacer()
                } else {
                    ScrollView {
                        VStack(spacing: AlchemySpacing.md) {
                            cookbookSearchBar
                            if !smartChips.isEmpty {
                                smartFilterChips
                            }
                            masonryGrid
                        }
                        .padding(.bottom, AlchemySpacing.xxxl)
                    }
                    .refreshable { await loadCookbook() }
                }
            }
            .background(AlchemyColors.background)
            .navigationBarHidden(true)
            .overlay {
                if showFullScreenPreview, let preview = selectedPreview {
                    CookbookFullScreenPreview(
                        preview: preview,
                        onOpenRecipe: {
                            showFullScreenPreview = false
                            navigateToRecipeId = preview.id
                        },
                        onDismiss: {
                            withAnimation(.easeOut(duration: 0.3)) {
                                showFullScreenPreview = false
                            }
                        }
                    )
                    .transition(.opacity)
                }
            }
            .navigationDestination(item: $navigateToRecipeId) { recipeId in
                RecipeDetailView(recipeId: recipeId)
            }
            .sheet(isPresented: $showPreferences) {
                PreferencesView()
            }
            .sheet(isPresented: $showSettings) {
                SettingsView()
            }
            .toolbarVisibility(showFullScreenPreview ? .hidden : .automatic, for: .tabBar)
            .task { await loadCookbook() }
            .onAppear {
                // Refresh when returning from another tab (e.g. after
                // saving from Sous Chef) so new recipes appear immediately.
                Task { await loadCookbook() }
            }
        }
    }

    // MARK: - Header

    private var headerBar: some View {
        HStack {
            Text("Cookbook")
                .font(AlchemyTypography.heading)
                .foregroundStyle(AlchemyColors.textPrimary)

            Spacer()

            ImportMenu()

            ProfileMenu(
                onPreferences: { showPreferences = true },
                onSettings: { showSettings = true }
            )
        }
        .padding(.horizontal, AlchemySpacing.screenHorizontal)
        .padding(.vertical, AlchemySpacing.md)
    }

    // MARK: - Search Bar

    private var cookbookSearchBar: some View {
        HStack(spacing: AlchemySpacing.sm) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(AlchemyColors.textTertiary)

            TextField("Search recipes...", text: $searchText)
                .font(AlchemyTypography.body)
                .foregroundStyle(AlchemyColors.textPrimary)

            if !searchText.isEmpty {
                Button {
                    searchText = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(AlchemyColors.textTertiary)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, AlchemySpacing.md)
        .padding(.vertical, AlchemySpacing.sm + 2)
        .background(AlchemyColors.surface)
        .clipShape(RoundedRectangle(cornerRadius: AlchemySpacing.buttonRadius))
        .padding(.horizontal, AlchemySpacing.screenHorizontal)
    }

    // MARK: - Smart Filter Chips

    /// Horizontal scroll strip of intelligently derived filter chips.
    /// Matches the Explore page style: clean white text labels, bold when
    /// selected, dimmed when inactive. No backgrounds or icons.
    private var smartFilterChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: AlchemySpacing.lg) {
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) { activeFilter = nil }
                } label: {
                    Text("All")
                        .font(.system(size: 18, weight: activeFilter == nil ? .bold : .regular))
                        .foregroundStyle(AlchemyColors.textPrimary.opacity(activeFilter == nil ? 1.0 : 0.4))
                }
                .buttonStyle(.plain)

                ForEach(smartChips) { chip in
                    let isSelected = activeFilter == chip
                    Button {
                        withAnimation(.easeInOut(duration: 0.2)) {
                            activeFilter = isSelected ? nil : chip
                        }
                    } label: {
                        Text(chip.label)
                            .font(.system(size: 18, weight: isSelected ? .bold : .regular))
                            .foregroundStyle(AlchemyColors.textPrimary.opacity(isSelected ? 1.0 : 0.4))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, AlchemySpacing.screenHorizontal)
            .padding(.vertical, AlchemySpacing.sm)
        }
    }

    // MARK: - Masonry Grid

    private var masonryGrid: some View {
        let cards = filteredPreviews
        let leftCards = cards.enumerated().filter { $0.offset % 2 == 0 }.map(\.element)
        let rightCards = cards.enumerated().filter { $0.offset % 2 != 0 }.map(\.element)

        return HStack(alignment: .top, spacing: AlchemySpacing.gridSpacing) {
            LazyVStack(spacing: AlchemySpacing.gridSpacing) {
                ForEach(leftCards) { preview in
                    cardCell(preview)
                }
            }

            LazyVStack(spacing: AlchemySpacing.gridSpacing) {
                ForEach(rightCards) { preview in
                    cardCell(preview)
                }
            }
        }
        .padding(.horizontal, AlchemySpacing.screenHorizontal)
    }

    private func cardCell(_ preview: CookbookEntryItem) -> some View {
        RecipeCardView(card: preview.asRecipeCard)
            .overlay(alignment: .topTrailing) {
                variantBadge(for: preview)
            }
            .onTapGesture {
                selectedPreview = preview
                withAnimation(.easeInOut(duration: 0.3)) {
                    showFullScreenPreview = true
                }
            }
            .contextMenu {
                Button {
                    selectedPreview = preview
                    withAnimation { showFullScreenPreview = true }
                } label: {
                    Label("View", systemImage: "eye")
                }

                Button {
                    // Edit — will navigate to Sous Chef with recipe loaded
                } label: {
                    Label("Edit", systemImage: "pencil")
                }

                ShareLink(
                    item: preview.title,
                    subject: Text(preview.title),
                    message: Text(preview.summary)
                ) {
                    Label("Share", systemImage: "square.and.arrow.up")
                }

                Divider()

                Button(role: .destructive) {
                    Task { await unsaveRecipe(preview.id) }
                } label: {
                    Label("Remove", systemImage: "trash")
                }
            }
    }

    /// Small badge overlay indicating variant personalisation state.
    /// Only shows when a variant is active. Uses sparkles for current,
    /// exclamation for stale/needs_review, xmark for failed.
    @ViewBuilder
    private func variantBadge(for entry: CookbookEntryItem) -> some View {
        switch entry.variantStatus {
        case "current":
            Image(systemName: "sparkles")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(.white)
                .padding(5)
                .background(AlchemyColors.accent)
                .clipShape(Circle())
                .padding(6)
        case "processing":
            ProgressView()
                .controlSize(.mini)
                .padding(5)
                .background(.ultraThinMaterial)
                .clipShape(Circle())
                .padding(6)
        case "stale", "needs_review":
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(.white)
                .padding(5)
                .background(.orange)
                .clipShape(Circle())
                .padding(6)
        case "failed":
            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(.white)
                .padding(5)
                .background(.red)
                .clipShape(Circle())
                .padding(6)
        default:
            EmptyView()
        }
    }

    // MARK: - Empty / Error States

    private var emptyView: some View {
        VStack(spacing: AlchemySpacing.md) {
            Image(systemName: "book.closed")
                .font(.system(size: 48))
                .foregroundStyle(AlchemyColors.textTertiary)
            Text("No recipes yet")
                .font(AlchemyTypography.subheading)
                .foregroundStyle(AlchemyColors.textSecondary)
            Text("Ask your Sous Chef to create your first recipe.")
                .font(AlchemyTypography.body)
                .foregroundStyle(AlchemyColors.textTertiary)
        }
    }

    private func errorView(_ message: String) -> some View {
        VStack(spacing: AlchemySpacing.md) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 48))
                .foregroundStyle(AlchemyColors.textTertiary)
            Text(message)
                .font(AlchemyTypography.body)
                .foregroundStyle(AlchemyColors.textSecondary)
                .multilineTextAlignment(.center)
            Button("Retry") {
                Task { await loadCookbook() }
            }
            .foregroundStyle(AlchemyColors.accent)
        }
        .padding(.horizontal, AlchemySpacing.screenHorizontal)
    }

    // MARK: - API

    private func loadCookbook() async {
        if previews.isEmpty { isLoading = true }
        errorMessage = nil

        do {
            let response: CookbookResponse = try await APIClient.shared.request("/recipes/cookbook")
            previews = response.items
        } catch {
            errorMessage = "Couldn't load your cookbook. Check your connection."
            print("[CookbookView] load failed: \(error)")
        }

        isLoading = false
    }

    private func unsaveRecipe(_ id: String) async {
        do {
            try await APIClient.shared.requestVoid("/recipes/\(id)/save", method: .delete)
            withAnimation {
                previews.removeAll { $0.id == id }
            }
        } catch {
            print("[CookbookView] unsave failed: \(error)")
        }
    }
}

// MARK: - Full Screen Preview

/// Bottom-anchored recipe preview that slides up, covering 90% of the screen.
struct CookbookFullScreenPreview: View {
    let preview: CookbookEntryItem
    var onOpenRecipe: () -> Void
    var onDismiss: () -> Void

    @State private var dragOffset: CGFloat = 0
    private let dismissThreshold: CGFloat = 120

    var body: some View {
        GeometryReader { geo in
            let panelHeight = geo.size.height * 0.90

            ZStack {
                Color.black.opacity(0.4)
                    .ignoresSafeArea()
                    .onTapGesture { onDismiss() }

                VStack {
                    Spacer()

                    ZStack(alignment: .top) {
                        LazyImage(url: preview.resolvedImageURL) { state in
                            if let image = state.image {
                                image
                                    .resizable()
                                    .aspectRatio(contentMode: .fill)
                            } else {
                                Rectangle().fill(AlchemyColors.surfaceSecondary)
                            }
                        }
                        .frame(width: geo.size.width, height: panelHeight)
                        .clipped()

                        Color.black.opacity(0.55)

                        VStack(spacing: AlchemySpacing.lg) {
                            RoundedRectangle(cornerRadius: 2.5)
                                .fill(.white.opacity(0.5))
                                .frame(width: 36, height: 5)
                                .padding(.top, AlchemySpacing.md)

                            Spacer()

                            VStack(spacing: AlchemySpacing.sm) {
                                Text(preview.title)
                                    .font(AlchemyTypography.displayLarge)
                                    .foregroundStyle(.white)
                                    .multilineTextAlignment(.center)
                                    .lineLimit(3)
                                    .shadow(color: .black.opacity(0.5), radius: 8, x: 0, y: 2)

                                Text(preview.summary)
                                    .font(AlchemyTypography.body)
                                    .foregroundStyle(.white.opacity(0.85))
                                    .multilineTextAlignment(.center)
                                    .lineLimit(3)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            .padding(.horizontal, AlchemySpacing.xl + AlchemySpacing.sm)

                            if let stats = preview.quickStats {
                                HStack(spacing: AlchemySpacing.xxl) {
                                    CompactGauge.time(minutes: stats.timeMinutes)
                                    CompactGauge.difficulty(stats.difficultyNormalized)
                                    CompactGauge.health(stats.healthNormalized)
                                    CompactGauge.ingredients(count: stats.items)
                                }
                                .padding(.top, AlchemySpacing.md)
                            }

                            Spacer()
                                .frame(height: AlchemySpacing.md)

                            Button {
                                onOpenRecipe()
                            } label: {
                                Text("Open Recipe")
                                    .font(AlchemyTypography.subheading)
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, AlchemySpacing.xxl)
                                    .padding(.vertical, AlchemySpacing.md)
                            }
                            .glassEffect(.regular, in: .capsule)

                            Spacer()
                                .frame(height: AlchemySpacing.xxxl + AlchemySpacing.xl)
                        }
                        .frame(height: panelHeight)
                    }
                    .frame(height: panelHeight)
                    .clipShape(
                        UnevenRoundedRectangle(
                            topLeadingRadius: 24,
                            bottomLeadingRadius: 0,
                            bottomTrailingRadius: 0,
                            topTrailingRadius: 24
                        )
                    )
                    .offset(y: max(dragOffset, 0))
                    .gesture(
                        DragGesture()
                            .onChanged { value in
                                dragOffset = value.translation.height
                            }
                            .onEnded { value in
                                if value.translation.height > dismissThreshold {
                                    onDismiss()
                                } else {
                                    withAnimation(.spring(duration: 0.3)) {
                                        dragOffset = 0
                                    }
                                }
                            }
                    )
                }
                .ignoresSafeArea(edges: .bottom)
            }
        }
    }
}

// MARK: - Smart Filter Chip Model

/// A filter chip intelligently derived from actual cookbook content.
///
/// The `generate(from:)` factory scans all entries, tallies tag values
/// across every dimension (cuisine, dietary, difficulty, time, occasion,
/// technique, category, personalization, recency), and ranks them by
/// "usefulness" — a chip is more useful when it selects a meaningful
/// subset (roughly 15–80% of items) rather than everything or nearly nothing.
///
/// Chips are deduplicated across dimensions: if "Italian" appears in both
/// `category` and `variantTags.cuisine`, only one chip surfaces.
enum CookbookChip: Identifiable, Hashable {
    case cuisine(String)
    case dietary(String)
    case difficulty(String)
    case quickUnder(Int)
    case occasion(String)
    case technique(String)
    case category(String)
    case personalized
    case recent

    var id: String {
        switch self {
        case .cuisine(let v):    return "cuisine:\(v)"
        case .dietary(let v):    return "dietary:\(v)"
        case .difficulty(let v): return "diff:\(v)"
        case .quickUnder(let m): return "quick:\(m)"
        case .occasion(let v):   return "occ:\(v)"
        case .technique(let v):  return "tech:\(v)"
        case .category(let v):   return "cat:\(v)"
        case .personalized:      return "meta:personalized"
        case .recent:            return "meta:recent"
        }
    }

    var label: String {
        switch self {
        case .cuisine(let v):    return v
        case .dietary(let v):    return v
        case .difficulty(let v): return v.capitalized
        case .quickUnder(let m): return "Under \(m) min"
        case .occasion(let v):   return v
        case .technique(let v):  return v
        case .category(let v):   return v
        case .personalized:      return "Personalized"
        case .recent:            return "Recent"
        }
    }

    var icon: String {
        switch self {
        case .cuisine:      return "globe"
        case .dietary:      return "leaf"
        case .difficulty:   return "flame"
        case .quickUnder:   return "clock"
        case .occasion:     return "calendar"
        case .technique:    return "frying.pan"
        case .category:     return "tag"
        case .personalized: return "sparkles"
        case .recent:       return "clock.badge"
        }
    }

    /// Whether a cookbook entry matches this chip.
    func matches(_ entry: CookbookEntryItem) -> Bool {
        switch self {
        case .cuisine(let v):
            return (entry.variantTags?.cuisine ?? []).contains(where: {
                $0.caseInsensitiveCompare(v) == .orderedSame
            })
        case .dietary(let v):
            return (entry.variantTags?.dietary ?? []).contains(where: {
                $0.caseInsensitiveCompare(v) == .orderedSame
            })
        case .difficulty(let v):
            let effective = entry.effectiveDifficulty ?? "medium"
            return effective.caseInsensitiveCompare(v) == .orderedSame
        case .quickUnder(let maxMin):
            return (entry.effectiveTimeMinutes ?? Int.max) <= maxMin
        case .occasion(let v):
            return (entry.variantTags?.occasion ?? []).contains(where: {
                $0.caseInsensitiveCompare(v) == .orderedSame
            })
        case .technique(let v):
            return (entry.variantTags?.technique ?? []).contains(where: {
                $0.caseInsensitiveCompare(v) == .orderedSame
            })
        case .category(let v):
            return entry.category?.caseInsensitiveCompare(v) == .orderedSame
        case .personalized:
            return entry.hasVariant
        case .recent:
            guard let date = ISO8601DateFormatter().date(from: entry.savedAt) else {
                return false
            }
            let daysAgo = Calendar.current.dateComponents(
                [.day], from: date, to: .now
            ).day ?? Int.max
            return daysAgo <= 14
        }
    }

    // MARK: - Intelligent Generation

    /// Placeholder categories excluded from chip generation.
    private static let excludedCategories: Set<String> = [
        "auto organized", "uncategorized",
    ]

    /// Max chips to surface — keeps the strip scannable.
    private static let maxChips = 10

    /// Minimum number of matching recipes for a chip to be worth showing.
    /// Below this threshold the filter is too narrow to be useful.
    private static let minMatchCount = 2

    /// Scans all cookbook entries and produces a ranked list of filter chips.
    ///
    /// Scoring heuristic: a chip is most useful when it selects 20–60% of
    /// the cookbook. Chips selecting everything (100%) or nearly nothing (<2)
    /// are excluded. Within the useful range, chips closer to 40% of total
    /// score highest — they create the most meaningful splits.
    static func generate(from entries: [CookbookEntryItem]) -> [CookbookChip] {
        guard entries.count >= 2 else { return [] }
        let total = Double(entries.count)

        var candidates: [(chip: CookbookChip, count: Int)] = []
        var seen = Set<String>()

        // -- Cuisine -------------------------------------------------------
        var cuisineCounts: [String: Int] = [:]
        for entry in entries {
            for c in entry.variantTags?.cuisine ?? [] {
                cuisineCounts[c, default: 0] += 1
            }
        }
        for (value, count) in cuisineCounts where count >= minMatchCount {
            let key = value.lowercased()
            guard !seen.contains(key) else { continue }
            seen.insert(key)
            candidates.append((.cuisine(value), count))
        }

        // -- Category (deduplicated against cuisine) -----------------------
        var categoryCounts: [String: Int] = [:]
        for entry in entries {
            if let cat = entry.category,
               !excludedCategories.contains(cat.lowercased()) {
                categoryCounts[cat, default: 0] += 1
            }
        }
        for (value, count) in categoryCounts where count >= minMatchCount {
            let key = value.lowercased()
            guard !seen.contains(key) else { continue }
            seen.insert(key)
            candidates.append((.category(value), count))
        }

        // -- Dietary -------------------------------------------------------
        var dietaryCounts: [String: Int] = [:]
        for entry in entries {
            for d in entry.variantTags?.dietary ?? [] {
                dietaryCounts[d, default: 0] += 1
            }
        }
        for (value, count) in dietaryCounts where count >= minMatchCount {
            candidates.append((.dietary(value), count))
        }

        // -- Occasion ------------------------------------------------------
        var occasionCounts: [String: Int] = [:]
        for entry in entries {
            for o in entry.variantTags?.occasion ?? [] {
                occasionCounts[o, default: 0] += 1
            }
        }
        for (value, count) in occasionCounts where count >= minMatchCount {
            candidates.append((.occasion(value), count))
        }

        // -- Technique -----------------------------------------------------
        var techniqueCounts: [String: Int] = [:]
        for entry in entries {
            for t in entry.variantTags?.technique ?? [] {
                techniqueCounts[t, default: 0] += 1
            }
        }
        for (value, count) in techniqueCounts where count >= minMatchCount {
            candidates.append((.technique(value), count))
        }

        // -- Difficulty (only surface if there's meaningful variety) --------
        var diffCounts: [String: Int] = [:]
        for entry in entries {
            let d = entry.effectiveDifficulty ?? "medium"
            diffCounts[d.lowercased(), default: 0] += 1
        }
        if diffCounts.keys.count >= 2 {
            if let easyCount = diffCounts["easy"], easyCount >= minMatchCount {
                candidates.append((.difficulty("easy"), easyCount))
            }
            if let complexCount = diffCounts["complex"], complexCount >= minMatchCount {
                candidates.append((.difficulty("complex"), complexCount))
            }
        }

        // -- Quick (time-based) --------------------------------------------
        let quickCount = entries.filter {
            ($0.effectiveTimeMinutes ?? Int.max) <= 30
        }.count
        if quickCount >= minMatchCount && quickCount < entries.count {
            candidates.append((.quickUnder(30), quickCount))
        }

        // -- Personalized --------------------------------------------------
        let personalizedCount = entries.filter { $0.hasVariant }.count
        if personalizedCount >= minMatchCount && personalizedCount < entries.count {
            candidates.append((.personalized, personalizedCount))
        }

        // -- Recent (saved in last 14 days) --------------------------------
        let formatter = ISO8601DateFormatter()
        let recentCount = entries.filter { entry in
            guard let date = formatter.date(from: entry.savedAt) else { return false }
            let days = Calendar.current.dateComponents([.day], from: date, to: .now).day ?? Int.max
            return days <= 14
        }.count
        if recentCount >= minMatchCount && recentCount < entries.count {
            candidates.append((.recent, recentCount))
        }

        // -- Score and rank ------------------------------------------------
        // Best score at ~40% coverage; falls off toward 0% and 100%.
        let scored = candidates.map { (chip, count) -> (CookbookChip, Double) in
            let ratio = Double(count) / total
            let score = 1.0 - abs(ratio - 0.4) * 2.0
            return (chip, max(score, 0.05))
        }

        return scored
            .sorted { $0.1 > $1.1 }
            .prefix(maxChips)
            .map(\.0)
    }
}

// MARK: - CookbookEntryItem → RecipeCard Conversion

extension CookbookEntryItem {
    /// Converts a cookbook entry to the UI RecipeCard model for
    /// compatibility with RecipeCardView and other existing components.
    var asRecipeCard: RecipeCard {
        RecipeCard(
            id: canonicalRecipeId,
            title: title,
            summary: summary,
            category: category ?? "Uncategorized",
            imageURL: resolvedImageURL,
            imageStatus: ImageStatus(rawValue: imageStatus) ?? .pending,
            updatedAt: ISO8601DateFormatter().date(from: updatedAt) ?? .now,
            cookTimeMinutes: quickStats?.timeMinutes ?? 30,
            difficulty: quickStats?.difficultyNormalized ?? 0.5,
            healthScore: quickStats?.healthNormalized ?? 0.5,
            ingredientCount: quickStats?.items ?? 8
        )
    }
}

// MARK: - RecipePreview → RecipeCard Conversion (Explore/Search)

extension RecipePreview {
    /// Converts an API RecipePreview to the UI RecipeCard model for
    /// compatibility with RecipeCardView in Explore/Search contexts.
    var asRecipeCard: RecipeCard {
        RecipeCard(
            id: id,
            title: title,
            summary: summary,
            category: category ?? "Uncategorized",
            imageURL: resolvedImageURL,
            imageStatus: ImageStatus(rawValue: imageStatus) ?? .pending,
            updatedAt: ISO8601DateFormatter().date(from: updatedAt) ?? .now,
            cookTimeMinutes: quickStats?.timeMinutes ?? 30,
            difficulty: quickStats?.difficultyNormalized ?? 0.5,
            healthScore: quickStats?.healthNormalized ?? 0.5,
            ingredientCount: quickStats?.items ?? 8
        )
    }
}
