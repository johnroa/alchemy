import Foundation

/// Dummy data for all screens during the scaffolding phase.
/// These mirror the API response shapes so the transition to real data is minimal:
/// just swap PreviewData references for API call results.
enum PreviewData {

    // MARK: - Recipe Cards (Cookbook grid)

    static let cookbookCards: [RecipeCard] = [
        RecipeCard(
            id: "r1",
            title: "Eggplant Parmesan",
            summary: "Crispy layers of eggplant with rich marinara and melted mozzarella",
            category: "Italian",
            imageURL: URL(string: "https://images.unsplash.com/photo-1625944230945-1b7dd3b949ab?w=800&q=80"),
            imageStatus: .ready,
            updatedAt: .now
        ),
        RecipeCard(
            id: "r2",
            title: "Miso Glazed Salmon",
            summary: "Caramelized white miso salmon with pickled ginger and scallions",
            category: "Japanese",
            imageURL: URL(string: "https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=800&q=80"),
            imageStatus: .ready,
            updatedAt: .now
        ),
        RecipeCard(
            id: "r3",
            title: "Thai Basil Chicken",
            summary: "Wok-fired chicken with holy basil, chilies, and garlic over jasmine rice",
            category: "Thai",
            imageURL: URL(string: "https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?w=800&q=80"),
            imageStatus: .ready,
            updatedAt: .now
        ),
        RecipeCard(
            id: "r4",
            title: "Mushroom Risotto",
            summary: "Creamy arborio rice with mixed wild mushrooms and aged parmesan",
            category: "Italian",
            imageURL: URL(string: "https://images.unsplash.com/photo-1476124369491-e7addf5db371?w=800&q=80"),
            imageStatus: .ready,
            updatedAt: .now
        ),
        RecipeCard(
            id: "r5",
            title: "Lamb Tagine",
            summary: "Slow-braised lamb with apricots, almonds, and warm Moroccan spices",
            category: "Moroccan",
            imageURL: URL(string: "https://images.unsplash.com/photo-1511690656952-34342bb7c2f2?w=800&q=80"),
            imageStatus: .ready,
            updatedAt: .now
        ),
        RecipeCard(
            id: "r6",
            title: "Crispy Fish Tacos",
            summary: "Beer-battered cod with chipotle crema, pickled onions, and lime",
            category: "Mexican",
            imageURL: URL(string: "https://images.unsplash.com/photo-1551504734-5ee1c4a1479b?w=800&q=80"),
            imageStatus: .ready,
            updatedAt: .now
        ),
    ]

    // MARK: - Full Recipe (Detail view)

    static let sampleRecipe = Recipe(
        id: "r1",
        title: "Eggplant Parmesan",
        summary: "Crispy layers of eggplant with rich marinara and melted mozzarella",
        servings: 4,
        category: "Italian",
        ingredients: [
            Ingredient(id: "i1", name: "Japanese eggplant", quantity: "2", unit: "large"),
            Ingredient(id: "i2", name: "Marinara sauce", quantity: "2", unit: "cups"),
            Ingredient(id: "i3", name: "Fresh mozzarella", quantity: "8", unit: "oz"),
            Ingredient(id: "i4", name: "Parmesan cheese", quantity: "1/2", unit: "cup"),
            Ingredient(id: "i5", name: "Panko breadcrumbs", quantity: "1", unit: "cup"),
            Ingredient(id: "i6", name: "Eggs", quantity: "2", unit: nil),
            Ingredient(id: "i7", name: "Fresh basil", quantity: "1/4", unit: "cup"),
            Ingredient(id: "i8", name: "Olive oil", quantity: "3", unit: "tbsp"),
            Ingredient(id: "i9", name: "Garlic cloves", quantity: "4", unit: nil),
            Ingredient(id: "i10", name: "Salt and pepper", quantity: "to taste", unit: nil),
        ],
        steps: [
            Step(id: "s1", number: 1, instruction: "Slice the eggplants into 1/2-inch rounds. Salt generously and let sit in a colander for 30 minutes to draw out moisture, then pat dry."),
            Step(id: "s2", number: 2, instruction: "Set up a breading station: flour in one dish, beaten eggs in another, and panko mixed with half the parmesan in a third."),
            Step(id: "s3", number: 3, instruction: "Dredge each eggplant round through flour, egg, then panko, pressing gently to adhere."),
            Step(id: "s4", number: 4, instruction: "Heat olive oil in a large skillet over medium-high heat. Fry eggplant rounds in batches until golden and crispy, about 3 minutes per side. Drain on paper towels."),
            Step(id: "s5", number: 5, instruction: "Preheat oven to 375°F. Spread a thin layer of marinara in a baking dish. Layer fried eggplant, more sauce, torn mozzarella, and basil. Repeat layers."),
            Step(id: "s6", number: 6, instruction: "Top with remaining parmesan. Bake uncovered for 25 minutes until bubbly and golden. Let rest 10 minutes before serving."),
        ],
        imageURL: URL(string: "https://images.unsplash.com/photo-1625944230945-1b7dd3b949ab?w=1200&q=80"),
        imageStatus: .ready,
        updatedAt: .now,
        nutrition: NutritionInfo(calories: 420, protein: 18, carbs: 32, fat: 24),
        quickStats: QuickStats(timeMinutes: 75, difficulty: 0.5, healthScore: 0.65, ingredientCount: 10)
    )

    // MARK: - Chat Messages (Generate / Onboarding)

    static let generateGreeting = ChatMessage(
        id: "msg-greeting",
        role: .assistant,
        content: "Chef, what are we making today?",
        createdAt: .now
    )

    static let sampleChatHistory: [ChatMessage] = [
        ChatMessage(id: "msg-1", role: .assistant, content: "Chef, what are we making today?", createdAt: .now.addingTimeInterval(-300)),
        ChatMessage(id: "msg-2", role: .user, content: "I want something hearty and Italian, maybe eggplant based?", createdAt: .now.addingTimeInterval(-240)),
        ChatMessage(id: "msg-3", role: .assistant, content: "Love that! How about a classic Eggplant Parmesan with a twist — using Japanese eggplant for a silkier texture and a miso-marinara sauce? I can also do a simple side salad to pair.", createdAt: .now.addingTimeInterval(-180)),
        ChatMessage(id: "msg-4", role: .user, content: "Yes! That sounds amazing. Let's go with that.", createdAt: .now.addingTimeInterval(-120)),
    ]

    static let onboardingMessages: [ChatMessage] = [
        ChatMessage(id: "ob-1", role: .assistant, content: "Welcome to Alchemy! I'm here to learn what you love to cook and eat. Let's start simple — do you have any dietary preferences or restrictions?", createdAt: .now.addingTimeInterval(-300)),
    ]

    // MARK: - Explore Cards

    static let exploreCards: [RecipeCard] = [
        RecipeCard(
            id: "e1",
            title: "Seared Duck Breast",
            summary: "Perfectly rendered duck with cherry gastrique and roasted root vegetables",
            category: "French",
            imageURL: URL(string: "https://images.unsplash.com/photo-1432139509613-5c4255a1d197?w=1200&q=80"),
            imageStatus: .ready,
            updatedAt: .now
        ),
        RecipeCard(
            id: "e2",
            title: "Charred Octopus",
            summary: "Tender grilled octopus with smoked paprika, crispy potatoes, and lemon oil",
            category: "Mediterranean",
            imageURL: URL(string: "https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=1200&q=80"),
            imageStatus: .ready,
            updatedAt: .now
        ),
        RecipeCard(
            id: "e3",
            title: "Truffle Pasta",
            summary: "Hand-rolled tagliatelle with black truffle butter and aged pecorino",
            category: "Italian",
            imageURL: URL(string: "https://images.unsplash.com/photo-1473093295043-cdd812d0e601?w=1200&q=80"),
            imageStatus: .ready,
            updatedAt: .now
        ),
        RecipeCard(
            id: "e4",
            title: "Korean Short Ribs",
            summary: "Galbi-marinated beef short ribs with sesame, pear, and gochujang glaze",
            category: "Korean",
            imageURL: URL(string: "https://images.unsplash.com/photo-1544025162-d76694265947?w=1200&q=80"),
            imageStatus: .ready,
            updatedAt: .now
        ),
    ]

    // MARK: - Filter Options

    static let exploreFilters = ["All", "Quick & Easy", "Healthy", "Comfort Food", "Date Night", "Vegetarian", "Under 30 Min"]

    static let cookbookCategories = ["All", "Italian", "Japanese", "Thai", "Mexican", "Moroccan", "French"]

    // MARK: - Recipe Components (Generate multi-tab)

    static let sampleComponents: [RecipeComponent] = [
        RecipeComponent(
            id: "comp-main",
            role: "Main Dish",
            title: "Eggplant Parmesan",
            recipe: sampleRecipe
        ),
        RecipeComponent(
            id: "comp-side",
            role: "Side",
            title: "Arugula Salad",
            recipe: Recipe(
                id: "r-side",
                title: "Arugula Salad with Lemon Vinaigrette",
                summary: "Peppery arugula with shaved parmesan, toasted pine nuts, and bright lemon dressing",
                servings: 4,
                category: "Salad",
                ingredients: [
                    Ingredient(id: "si1", name: "Baby arugula", quantity: "5", unit: "oz"),
                    Ingredient(id: "si2", name: "Parmesan", quantity: "1/4", unit: "cup"),
                    Ingredient(id: "si3", name: "Pine nuts", quantity: "2", unit: "tbsp"),
                    Ingredient(id: "si4", name: "Lemon juice", quantity: "2", unit: "tbsp"),
                    Ingredient(id: "si5", name: "Extra virgin olive oil", quantity: "3", unit: "tbsp"),
                ],
                steps: [
                    Step(id: "ss1", number: 1, instruction: "Toast pine nuts in a dry skillet over medium heat until golden, about 2 minutes. Set aside."),
                    Step(id: "ss2", number: 2, instruction: "Whisk together lemon juice, olive oil, salt and pepper to make the vinaigrette."),
                    Step(id: "ss3", number: 3, instruction: "Toss arugula with vinaigrette. Top with shaved parmesan and toasted pine nuts."),
                ],
                imageURL: URL(string: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=1200&q=80"),
                imageStatus: .ready,
                updatedAt: .now,
                nutrition: NutritionInfo(calories: 180, protein: 6, carbs: 4, fat: 16),
                quickStats: QuickStats(timeMinutes: 10, difficulty: 0.15, healthScore: 0.9, ingredientCount: 5)
            )
        ),
    ]
}
