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
