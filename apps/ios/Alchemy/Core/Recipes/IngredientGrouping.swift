import Foundation

enum IngredientGroupingMode: String {
    case flat
    case category
    case component

    static let defaultMode: IngredientGroupingMode = .component

    init(rawPreference: String?) {
        switch rawPreference {
        case Self.flat.rawValue:
            self = .flat
        case Self.category.rawValue:
            self = .category
        case Self.component.rawValue:
            self = .component
        default:
            self = Self.defaultMode
        }
    }
}

enum IngredientGrouping {
    static func groups(
        for ingredients: [APIIngredient],
        preference: String
    ) -> [APIIngredientGroup]? {
        let mode = IngredientGroupingMode(rawPreference: preference)
        guard mode != .flat else { return nil }

        var labelsInOrder: [String] = []
        var buckets: [String: [APIIngredient]] = [:]

        for ingredient in ingredients {
            let rawLabel: String?
            switch mode {
            case .flat:
                rawLabel = nil
            case .category:
                rawLabel = ingredient.category
            case .component:
                rawLabel = ingredient.component
            }

            let fallback = mode == .category ? "Other" : "Main"
            let label = normalizedLabel(rawLabel, fallback: fallback)

            if buckets[label] == nil {
                labelsInOrder.append(label)
                buckets[label] = []
            }
            buckets[label, default: []].append(ingredient)
        }

        return labelsInOrder.map { label in
            APIIngredientGroup(
                key: label.lowercased(),
                label: label,
                ingredients: buckets[label] ?? []
            )
        }
    }

    private static func normalizedLabel(_ rawLabel: String?, fallback: String) -> String {
        let trimmed = rawLabel?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let base = trimmed.isEmpty ? fallback : trimmed

        return base
            .split(separator: " ")
            .map { part in
                guard let first = part.first else { return "" }
                return String(first).uppercased() + part.dropFirst()
            }
            .joined(separator: " ")
    }
}
