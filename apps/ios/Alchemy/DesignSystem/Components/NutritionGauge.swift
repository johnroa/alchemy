import SwiftUI

/// Circular gauge used in the glass preview modal for recipe quick stats.
///
/// Flat white design with subtle shadow — inspired by Apple's ring gauges
/// but simplified: a single arc on a track with a label below.
/// The `value` is 0.0–1.0 representing the fill percentage.
struct NutritionGauge: View {
    let title: String
    let value: Double
    let displayValue: String

    /// Track and fill line width
    private let lineWidth: CGFloat = 3.5
    /// Gauge diameter — compact size so four fit comfortably in a row
    private let size: CGFloat = 40

    var body: some View {
        VStack(spacing: AlchemySpacing.md) {
            ZStack {
                // Background track
                Circle()
                    .stroke(
                        Color.white.opacity(0.15),
                        lineWidth: lineWidth
                    )

                // Filled arc — starts from 12 o'clock (-90°)
                Circle()
                    .trim(from: 0, to: value)
                    .stroke(
                        Color.white,
                        style: StrokeStyle(lineWidth: lineWidth, lineCap: .round)
                    )
                    .rotationEffect(.degrees(-90))
                    .shadow(color: .white.opacity(0.3), radius: 2, x: 0, y: 0)
            }
            .frame(width: size, height: size)

            VStack(spacing: 2) {
                Text(title)
                    .font(AlchemyTypography.caption)
                    .foregroundStyle(.white.opacity(0.7))

                Text(displayValue)
                    .font(AlchemyTypography.captionBold)
                    .foregroundStyle(.white)
            }
        }
    }
}

/// Convenience initializers for the four standard recipe gauges.
extension NutritionGauge {
    /// Time gauge — normalizes minutes to a 0–120 min scale
    static func time(minutes: Int) -> NutritionGauge {
        NutritionGauge(
            title: "Time",
            value: min(Double(minutes) / 120.0, 1.0),
            displayValue: "\(minutes) min"
        )
    }

    /// Difficulty gauge — takes a 0.0–1.0 value directly
    static func difficulty(_ value: Double) -> NutritionGauge {
        let label = value < 0.33 ? "Easy" : value < 0.66 ? "Medium" : "Hard"
        return NutritionGauge(title: "Difficulty", value: value, displayValue: label)
    }

    /// Health score gauge — takes a 0.0–1.0 value directly
    static func health(_ value: Double) -> NutritionGauge {
        return NutritionGauge(
            title: "Healthy",
            value: value,
            displayValue: "\(Int(value * 100))%"
        )
    }

    /// Ingredient count gauge — normalizes to a 0–20 scale
    static func ingredients(count: Int) -> NutritionGauge {
        return NutritionGauge(
            title: "Items",
            value: min(Double(count) / 20.0, 1.0),
            displayValue: "\(count)"
        )
    }
}
