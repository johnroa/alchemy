import SwiftUI

struct MacroRingView: View {
    let label: String
    let value: Double
    let total: Double
    let color: Color
    var unit: String = "g"
    var ringSize: CGFloat = 52

    private var fraction: Double {
        guard total > 0 else { return 0 }
        return min(value / total, 1.0)
    }

    var body: some View {
        VStack(spacing: Spacing.xs) {
            ZStack {
                Circle()
                    .stroke(color.opacity(0.15), lineWidth: 4)

                Circle()
                    .trim(from: 0, to: fraction)
                    .stroke(color, style: StrokeStyle(lineWidth: 4, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(.spring(response: 0.6), value: fraction)

                Text("\(Int(value))")
                    .font(AlchemyFont.caption)
                    .foregroundStyle(AlchemyColors.textPrimary)
            }
            .frame(width: ringSize, height: ringSize)

            Text(label)
                .font(AlchemyFont.micro)
                .foregroundStyle(AlchemyColors.textTertiary)
        }
    }
}

struct NutritionWidget: View {
    let calories: Double?
    let proteinG: Double?
    let carbsG: Double?
    let fatG: Double?

    private var totalMacroG: Double {
        (proteinG ?? 0) + (carbsG ?? 0) + (fatG ?? 0)
    }

    var body: some View {
        VStack(spacing: Spacing.md) {
            // Calories header
            if let cal = calories {
                HStack(spacing: Spacing.xs) {
                    Image(systemName: "flame.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(AlchemyColors.warning)
                    Text("\(Int(cal)) cal")
                        .font(AlchemyFont.bodyBold)
                        .foregroundStyle(AlchemyColors.textPrimary)
                }
            }

            // Macro rings
            HStack(spacing: Spacing.xl) {
                if let protein = proteinG {
                    MacroRingView(
                        label: "Protein",
                        value: protein,
                        total: max(totalMacroG, 1),
                        color: AlchemyColors.info
                    )
                }

                if let carbs = carbsG {
                    MacroRingView(
                        label: "Carbs",
                        value: carbs,
                        total: max(totalMacroG, 1),
                        color: AlchemyColors.success
                    )
                }

                if let fat = fatG {
                    MacroRingView(
                        label: "Fat",
                        value: fat,
                        total: max(totalMacroG, 1),
                        color: AlchemyColors.warning
                    )
                }
            }
        }
        .padding(Spacing.md)
        .background(AlchemyColors.card)
        .clipShape(RoundedRectangle(cornerRadius: Radius.lg))
        .overlay(
            RoundedRectangle(cornerRadius: Radius.lg)
                .stroke(Color.white.opacity(0.06), lineWidth: 0.5)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(nutritionAccessibilityLabel)
    }

    private var nutritionAccessibilityLabel: String {
        var parts: [String] = []
        if let cal = calories { parts.append("\(Int(cal)) calories") }
        if let p = proteinG { parts.append("\(Int(p)) grams protein") }
        if let c = carbsG { parts.append("\(Int(c)) grams carbs") }
        if let f = fatG { parts.append("\(Int(f)) grams fat") }
        return parts.joined(separator: ", ")
    }
}

#if DEBUG
#Preview("Nutrition Widget") {
    NutritionWidget(calories: 520, proteinG: 38, carbsG: 52, fatG: 16)
        .padding()
        .background(AlchemyColors.deepDark)
        .preferredColorScheme(.dark)
}
#endif
