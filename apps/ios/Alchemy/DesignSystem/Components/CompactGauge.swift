import SwiftUI

/// Small circular gauge with SF Symbol icon inside the ring and a label below.
///
/// Used on Explore cards (TikTok-style vertical rail) and the Cookbook
/// full-screen preview. Ring arc shows progress 0–1, icon sits centered.
struct CompactGauge: View {
    let value: Double
    let label: String
    let icon: String

    /// Gauge diameter — 36pt fits comfortably in both vertical and horizontal layouts
    private let size: CGFloat = 36
    private let lineWidth: CGFloat = 2.5

    var body: some View {
        VStack(spacing: 4) {
            ZStack {
                Circle()
                    .stroke(Color.white.opacity(0.2), lineWidth: lineWidth)

                Circle()
                    .trim(from: 0, to: value)
                    .stroke(Color.white.opacity(0.9),
                            style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                    .rotationEffect(.degrees(-90))

                Image(systemName: icon)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.white)
            }
            .frame(width: size, height: size)
            .shadow(color: .black.opacity(0.4), radius: 4)

            Text(label)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.white.opacity(0.85))
                .shadow(color: .black.opacity(0.4), radius: 3)
        }
    }
}

// MARK: - Convenience Factories

extension CompactGauge {
    /// Time gauge — normalizes minutes to a 0–120 min scale
    static func time(minutes: Int) -> CompactGauge {
        CompactGauge(
            value: min(Double(minutes) / 120.0, 1.0),
            label: "\(minutes)m",
            icon: "clock"
        )
    }

    /// Difficulty gauge — 0.0–1.0 mapped to Easy/Med/Hard
    static func difficulty(_ value: Double) -> CompactGauge {
        let label = value < 0.33 ? "Easy" : value < 0.66 ? "Med" : "Hard"
        return CompactGauge(value: value, label: label, icon: "flame")
    }

    /// Health score gauge — 0.0–1.0 shown as percentage
    static func health(_ value: Double) -> CompactGauge {
        CompactGauge(value: value, label: "\(Int(value * 100))%", icon: "heart")
    }

    /// Ingredient count gauge — normalizes to a 0–20 scale
    static func ingredients(count: Int) -> CompactGauge {
        CompactGauge(
            value: min(Double(count) / 20.0, 1.0),
            label: "\(count)",
            icon: "basket"
        )
    }
}

// MARK: - Recipe Badge

/// Pill badge for contextual signals (New, Trending, Popular) shown in the
/// explore card right-side rail alongside CompactGauges.
struct RecipeBadge: View {
    let label: String
    let icon: String
    let tint: Color

    var body: some View {
        VStack(spacing: 4) {
            ZStack {
                Circle()
                    .fill(tint.opacity(0.3))

                Circle()
                    .stroke(tint.opacity(0.6), lineWidth: 1.5)

                Image(systemName: icon)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(tint)
            }
            .frame(width: 36, height: 36)
            .shadow(color: tint.opacity(0.4), radius: 4)

            Text(label)
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(tint)
                .shadow(color: .black.opacity(0.4), radius: 3)
        }
    }
}

extension RecipeBadge {
    static var trending: RecipeBadge {
        RecipeBadge(label: "Hot", icon: "flame.fill", tint: .orange)
    }

    static var popular: RecipeBadge {
        RecipeBadge(label: "Popular", icon: "heart.fill", tint: .pink)
    }

    static var new: RecipeBadge {
        RecipeBadge(label: "New", icon: "sparkles", tint: .cyan)
    }
}

// MARK: - Explore Rail

/// Vertical right-edge rail for Explore cards combining contextual badges
/// (New, Trending, Popular) and stat gauges (time, difficulty, health, items).
///
/// Badges are derived from the RecipePreview's save/variant counts and recency.
/// Gauges show when quickStats is available on the preview.
struct ExploreRail: View {
    let preview: RecipePreview

    /// Threshold: recipes updated within this many days are considered "New".
    private static let newThresholdDays = 7
    /// Threshold: save count above this marks a recipe as "Popular".
    private static let popularThreshold = 5

    var body: some View {
        VStack(spacing: AlchemySpacing.md) {
            ForEach(badges, id: \.label) { badge in
                badge
            }

            if let stats = preview.quickStats {
                CompactGauge.time(minutes: stats.timeMinutes)
                CompactGauge.difficulty(stats.difficultyNormalized)
                CompactGauge.health(stats.healthNormalized)
                CompactGauge.ingredients(count: stats.items)
            }
        }
    }

    /// Derives which contextual badges to show. A recipe can earn
    /// multiple badges but we cap at 2 to keep the rail compact.
    private var badges: [RecipeBadge] {
        var result: [RecipeBadge] = []

        if isNew { result.append(.new) }
        if isPopular { result.append(.popular) }

        return Array(result.prefix(2))
    }

    /// A recipe is "new" if updatedAt is within the last N days.
    private var isNew: Bool {
        guard let date = ISO8601DateFormatter().date(from: preview.updatedAt) else {
            return false
        }
        let daysAgo = Calendar.current.dateComponents(
            [.day], from: date, to: .now
        ).day ?? Int.max
        return daysAgo <= Self.newThresholdDays
    }

    private var isPopular: Bool {
        (preview.saveCount ?? 0) >= Self.popularThreshold
    }
}
