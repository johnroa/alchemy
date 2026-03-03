import Foundation

#if DEBUG
enum PreviewData {
    static let recipeCards: [RecipeCard] = [
        RecipeCard(
            id: "r1",
            title: "Crispy Miso Salmon Bowl",
            summary: "Flaky salmon with pickled radish, edamame, and a ginger-miso glaze over fluffy rice.",
            imageUrl: nil,
            category: "Asian"
        ),
        RecipeCard(
            id: "r2",
            title: "Lemon Herb Roast Chicken",
            summary: "Juicy whole roasted chicken with rosemary, thyme, and a bright lemon pan sauce.",
            imageUrl: nil,
            category: "Comfort"
        ),
        RecipeCard(
            id: "r3",
            title: "Mushroom Risotto",
            summary: "Creamy arborio rice with mixed wild mushrooms, parmesan, and truffle oil.",
            imageUrl: nil,
            category: "Italian"
        ),
        RecipeCard(
            id: "r4",
            title: "Thai Green Curry",
            summary: "Fragrant coconut curry with chicken, bamboo shoots, and Thai basil.",
            imageUrl: nil,
            category: "Asian"
        ),
        RecipeCard(
            id: "r5",
            title: "Classic Margherita Pizza",
            summary: "San Marzano tomatoes, fresh mozzarella, and basil on a crispy thin crust.",
            imageUrl: nil,
            category: "Italian"
        ),
    ]

    static let recipeView = RecipeView(
        id: "r1",
        title: "Crispy Miso Salmon Bowl",
        description: "A balanced and beautiful bowl.",
        summary: "Flaky salmon with pickled radish, edamame, and a ginger-miso glaze over fluffy rice.",
        imageUrl: nil,
        servings: 2,
        ingredients: [
            RecipeIngredient(name: "Salmon fillet", amount: 2, unit: "pieces"),
            RecipeIngredient(name: "White miso paste", amount: 2, unit: "tbsp"),
            RecipeIngredient(name: "Sushi rice", amount: 1.5, unit: "cups"),
            RecipeIngredient(name: "Edamame", amount: 1, unit: "cup"),
            RecipeIngredient(name: "Radish", amount: 4, unit: "pieces"),
            RecipeIngredient(name: "Rice vinegar", amount: 2, unit: "tbsp"),
            RecipeIngredient(name: "Sesame oil", amount: 1, unit: "tbsp"),
            RecipeIngredient(name: "Soy sauce", amount: 1, unit: "tbsp"),
            RecipeIngredient(name: "Fresh ginger", amount: 1, unit: "tsp"),
        ],
        steps: [
            RecipeStep(index: 1, instruction: "Cook the sushi rice according to package directions. Season with rice vinegar."),
            RecipeStep(index: 2, instruction: "Mix miso paste with a splash of soy sauce, sesame oil, and grated ginger."),
            RecipeStep(index: 3, instruction: "Pat salmon dry and coat the top with the miso glaze.", timerSeconds: 60),
            RecipeStep(index: 4, instruction: "Sear salmon skin-side down in a hot pan for 4 minutes, then flip and cook 3 more minutes.", timerSeconds: 420, notes: "Don't move the salmon while searing for a crispy skin."),
            RecipeStep(index: 5, instruction: "Quick-pickle the sliced radish in rice vinegar for 10 minutes.", timerSeconds: 600),
            RecipeStep(index: 6, instruction: "Assemble bowls: rice base, salmon, edamame, pickled radish. Drizzle remaining glaze."),
        ],
        notes: "For extra crunch, top with toasted sesame seeds and nori strips.",
        pairings: ["Dry Riesling", "Junmai Sake", "Sparkling Water with Yuzu"],
        metadata: RecipeMetadata(
            vibe: "Fresh & Balanced",
            nutrition: RecipeNutrition(
                calories: 520,
                proteinG: 38,
                carbsG: 52,
                fatG: 16,
                fiberG: 4
            ),
            difficulty: "intermediate",
            timing: RecipeTiming(prepMinutes: 15, cookMinutes: 25, totalMinutes: 40),
            cuisineTags: ["Japanese", "Fusion"]
        ),
        visibility: "private",
        updatedAt: "2026-02-28T12:00:00Z",
        category: "Asian"
    )

    static let historyVersions: [HistoryVersion] = [
        HistoryVersion(id: "v1", diffSummary: nil, createdAt: "2026-02-28T12:00:00Z"),
        HistoryVersion(id: "v2", parentVersionId: "v1", diffSummary: "Reduced sodium, added pickled radish", createdAt: "2026-02-28T14:30:00Z"),
        HistoryVersion(id: "v3", parentVersionId: "v2", diffSummary: "Swapped brown rice for sushi rice", createdAt: "2026-03-01T09:15:00Z"),
    ]

    static let changelogItems: [ChangelogItem] = [
        ChangelogItem(id: "c1", scope: "recipe", entityType: "recipe", action: "create", createdAt: "2026-03-01T10:00:00Z"),
        ChangelogItem(id: "c2", scope: "recipe", entityType: "recipe", action: "tweak", createdAt: "2026-03-01T10:15:00Z"),
        ChangelogItem(id: "c3", scope: "memory", entityType: "memory", action: "extract", createdAt: "2026-03-01T10:20:00Z"),
    ]
}
#endif
