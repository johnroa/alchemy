import Foundation

/// Heuristic engine that determines whether a URL is likely a recipe page.
///
/// Three-layer detection strategy, scored and combined:
///
/// 1. **Known domains** — ~200 major recipe sites and food blogs. An exact
///    domain match is high-confidence but not sufficient alone (e.g. the
///    NYT Cooking homepage isn't a recipe).
/// 2. **Path keywords** — segments like `/recipe/`, `/recipes/`,
///    `/r/`, `/meal/`, etc. These are strong signals regardless of domain.
/// 3. **Slug analysis** — the last path component is checked for food/cooking
///    vocabulary: ingredient names, cooking verbs, dish types, cuisine terms.
///    A slug like `easy-chicken-parmesan-recipe` scores very high.
///
/// The final verdict requires a combined score above a threshold, so a
/// known recipe domain with a homepage URL won't trigger, but an unknown
/// food blog with `/recipes/garlic-butter-shrimp` will.
enum RecipeURLDetector {

    /// Returns true if the URL is likely a recipe page.
    static func isLikelyRecipe(urlString: String) -> Bool {
        let trimmed = urlString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed),
              let host = url.host?.lowercased() else {
            return false
        }

        let path = url.path.lowercased()

        // Ignore very short paths (homepages) unless they have query params
        // that suggest a recipe (e.g. ?id=12345 on some sites).
        let isHomepage = path == "/" || path.isEmpty

        var score = 0

        // Layer 1: Known recipe domain
        let domain = stripWWW(host)
        if knownRecipeDomains.contains(domain) {
            score += 40
        } else if knownRecipeSubdomains.contains(where: { host.hasSuffix($0) }) {
            score += 35
        }

        // Layer 2: Path structure keywords
        let pathSegments = path.split(separator: "/").map(String.init)
        for segment in pathSegments {
            if recipePathKeywords.contains(segment) {
                score += 35
                break
            }
        }

        // Layer 3: Slug analysis — check the last meaningful path component
        // for food/cooking vocabulary
        if let slug = lastMeaningfulSlug(from: pathSegments) {
            let words = slug.split(separator: "-").map(String.init)
            var slugHits = 0
            for word in words {
                if foodVocabulary.contains(word) {
                    slugHits += 1
                }
            }
            // Each food word in the slug adds confidence
            score += min(slugHits * 10, 40)
        }

        // Homepages need an exceptionally high score (basically impossible
        // without path keywords, which homepages don't have).
        if isHomepage {
            return score >= 80
        }

        // Non-homepage: threshold of 50 means we need either:
        // - known domain (40) + at least one food word in slug (10)
        // - path keyword (35) + at least two food words (20)
        // - known domain (40) + path keyword (35) → 75, easy pass
        // - unknown domain + path keyword (35) + several food words (30+)
        return score >= 50
    }

    // MARK: - Helpers

    private static func stripWWW(_ host: String) -> String {
        host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }

    /// Returns the last non-numeric, non-trivial path segment as a
    /// slug candidate. Skips segments that are pure IDs or very short.
    private static func lastMeaningfulSlug(from segments: [String]) -> String? {
        for segment in segments.reversed() {
            // Skip pure numeric IDs, query artifacts, and very short segments
            if segment.count < 4 { continue }
            if segment.allSatisfy({ $0.isNumber }) { continue }
            // Skip common non-content segments
            if nonContentSegments.contains(segment) { continue }
            return segment
        }
        return nil
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // MARK: - Known Recipe Domains (~200)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /// Major recipe platforms, food media, and popular food blogs.
    /// Stripped of "www." for matching. Sorted alphabetically.
    private static let knownRecipeDomains: Set<String> = [
        // ── Major platforms ──
        "allrecipes.com",
        "bbc.co.uk",
        "bbcgoodfood.com",
        "bonappetit.com",
        "budgetbytes.com",
        "cooking.nytimes.com",
        "cookinglight.com",
        "delish.com",
        "eatingwell.com",
        "epicurious.com",
        "food.com",
        "food52.com",
        "foodandwine.com",
        "foodnetwork.com",
        "forksoverknives.com",
        "jamieoliver.com",
        "marthastewart.com",
        "myrecipes.com",
        "recipes.net",
        "seriouseats.com",
        "simplyrecipes.com",
        "tasteofhome.com",
        "tasty.co",
        "thekitchn.com",
        "yummly.com",

        // ── Large food media / magazines ──
        "112.international.com",
        "americastestkitchen.com",
        "cooksillustrated.com",
        "cooksscience.com",
        "kingarthurbaking.com",
        "realsimple.com",
        "saveur.com",
        "sunset.com",
        "tasteandtellblog.com",
        "thepioneerwoman.com",
        "thecookierookie.com",

        // ── Dietary / specialty ──
        "101cookbooks.com",
        "cleanfoodcrush.com",
        "cookieandkate.com",
        "damndelicious.net",
        "detoxinista.com",
        "downshiftology.com",
        "drfuhrman.com",
        "elavegan.com",
        "fedupped.com",
        "fitmencook.com",
        "greenkitchenstories.com",
        "halfbakedharvest.com",
        "loveandlemons.com",
        "minimalistbaker.com",
        "ohsheglows.com",
        "pickuplimes.com",
        "plantbasednews.org",
        "rainbowplantlife.com",
        "skinnytaste.com",
        "thefirstmess.com",
        "vegrecipesofindia.com",
        "wholefoodsmarket.com",

        // ── International / ethnic cuisine ──
        "chinesecookingdemystified.com",
        "closetcooking.com",
        "davidlebovitz.com",
        "gimmesomeoven.com",
        "indianhealthyrecipes.com",
        "japaneserecipes.com",
        "justonecookbook.com",
        "koreanbapsang.com",
        "maangchi.com",
        "mexicoinmykitchen.com",
        "pinchofyum.com",
        "recipetineats.com",
        "sprinklesandsprouts.com",
        "themediterraneandish.com",
        "thewoksoflife.com",
        "tieghangerard.com",

        // ── Popular food bloggers ──
        "addapinch.com",
        "ambitiouskitchen.com",
        "acouplecooks.com",
        "averiecooks.com",
        "bakedbyrachel.com",
        "bakerbynature.com",
        "butterbeready.com",
        "cafedelites.com",
        "carlsbadcravings.com",
        "centercut.com",
        "chefsteps.com",
        "copykat.com",
        "dinnerthendessert.com",
        "domesticate-me.com",
        "eatyourselfskinny.com",
        "geniuskitchen.com",
        "hostthetoast.com",
        "howsweeteats.com",
        "iamafoodblog.com",
        "inspiredtaste.net",
        "joyfoodsunshine.com",
        "justataste.com",
        "keviniscooking.com",
        "kitchenconfidante.com",
        "lifeofpurpose.com",
        "littlespicejar.com",
        "momontimeout.com",
        "natashaskitchen.com",
        "nomnompaleo.com",
        "onceuponachef.com",
        "paleomg.com",
        "preppykitchen.com",
        "rachelcooks.com",
        "reluctantentertainer.com",
        "sallysbakingaddiction.com",
        "savorysweetlife.com",
        "smittenkitchen.com",
        "spendwithpennies.com",
        "sweetpeasandsaffron.com",
        "tablefortwoblog.com",
        "thecafesucrefarine.com",
        "therecipecritic.com",
        "thestayathomechef.com",
        "twopeasandtheirpod.com",
        "wellplated.com",
        "whatsgabycooking.com",
        "wiltoncakes.com",
        "yammiesnoshery.com",

        // ── Grocery / retail with recipe sections ──
        "blueapron.com",
        "greatchef.com",
        "hellofresh.com",
        "homechef.com",
        "sunbasket.com",
        "traderjoes.com",
        "wegmans.com",

        // ── Baking-focused ──
        "bakefromscratch.com",
        "handletheheat.com",
        "kingarthurflour.com",
        "livewellbakeoften.com",
        "mybakingaddiction.com",
        "preppy-kitchen.com",
        "sugarspunrun.com",

        // ── Video / social recipe platforms ──
        "buzzfeed.com",
        "insider.com",
        "mealime.com",
        "mobkitchen.co.uk",
        "sorted.club",
        "sortedfood.com",
        "tastemade.com",
        "thefeedfeed.com",

        // ── Regional / country-specific ──
        "allrecipes.co.uk",
        "bbcgoodfood.co.uk",
        "chefkoch.de",
        "cuisineaz.com",
        "giallozafferano.it",
        "kochbar.de",
        "lecker.de",
        "marmiton.org",
        "750g.com",
        "taste.com.au",
    ]

    /// Subdomains that signal recipe content (e.g. cooking.nytimes.com,
    /// food.ndtv.com). Matched with `hasSuffix` on the full host.
    private static let knownRecipeSubdomains: Set<String> = [
        "cooking.nytimes.com",
        "food.ndtv.com",
        "recipes.timesofindia.com",
        "food.yahoo.com",
    ]

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // MARK: - Path Keywords
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /// URL path segments that strongly indicate a recipe page.
    private static let recipePathKeywords: Set<String> = [
        "recipe", "recipes", "recette", "recettes", "rezept", "rezepte",
        "ricetta", "ricette", "receta", "recetas",
        "cooking", "cook", "bake", "baking",
        "meal", "meals", "dish", "dishes",
        "how-to-make", "how-to-cook", "how-to-bake",
        "ingredient", "ingredients",
        "cuisine", "cuisines",
        "dinner", "dinners", "lunch", "breakfast", "brunch",
        "appetizer", "appetizers", "dessert", "desserts",
        "snack", "snacks", "side-dish", "side-dishes",
        "main-course", "entree", "entrees",
        "cocktail", "cocktails", "drink", "drinks",
        "smoothie", "smoothies",
    ]

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // MARK: - Food Vocabulary (slug analysis)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /// Words commonly found in recipe URL slugs. Covers proteins, produce,
    /// grains, dairy, cooking methods, dish types, cuisine terms, and
    /// recipe-specific adjectives. Each match in the slug adds confidence.
    private static let foodVocabulary: Set<String> = [
        // ── Proteins ──
        "chicken", "beef", "pork", "steak", "lamb", "turkey", "duck",
        "salmon", "shrimp", "fish", "tuna", "cod", "tilapia", "crab",
        "lobster", "scallop", "scallops", "clam", "clams", "mussel",
        "mussels", "oyster", "oysters", "prawn", "prawns", "anchovy",
        "sausage", "bacon", "ham", "chorizo", "pepperoni", "salami",
        "tofu", "tempeh", "seitan",

        // ── Vegetables ──
        "potato", "potatoes", "tomato", "tomatoes", "onion", "onions",
        "garlic", "broccoli", "spinach", "kale", "cabbage", "carrot",
        "carrots", "celery", "pepper", "peppers", "zucchini", "squash",
        "eggplant", "aubergine", "mushroom", "mushrooms", "asparagus",
        "artichoke", "corn", "peas", "beans", "lentil", "lentils",
        "chickpea", "chickpeas", "avocado", "cucumber", "beet", "beets",
        "turnip", "radish", "leek", "leeks", "cauliflower", "brussels",
        "sprouts", "arugula", "watercress", "chard", "fennel", "okra",
        "edamame", "jalapeno", "habanero", "poblano", "serrano",

        // ── Fruits ──
        "apple", "apples", "banana", "bananas", "lemon", "lime",
        "orange", "oranges", "strawberry", "strawberries", "blueberry",
        "blueberries", "raspberry", "raspberries", "blackberry",
        "mango", "peach", "peaches", "pear", "pears", "cherry",
        "cherries", "plum", "plums", "pineapple", "coconut", "fig",
        "pomegranate", "cranberry", "cranberries", "watermelon",
        "grapefruit", "papaya", "passion", "guava", "kiwi",

        // ── Grains / starches ──
        "rice", "pasta", "noodle", "noodles", "bread", "flour",
        "oat", "oats", "oatmeal", "quinoa", "couscous", "barley",
        "farro", "polenta", "cornmeal", "tortilla", "tortillas",
        "pita", "flatbread", "sourdough", "brioche", "focaccia",
        "gnocchi", "risotto", "orzo", "penne", "rigatoni",
        "spaghetti", "linguine", "fettuccine", "macaroni", "ramen",
        "udon", "soba",

        // ── Dairy / eggs ──
        "cheese", "butter", "cream", "milk", "yogurt", "egg", "eggs",
        "mozzarella", "parmesan", "cheddar", "gouda", "brie",
        "ricotta", "feta", "mascarpone", "gruyere",

        // ── Herbs / spices / seasonings ──
        "basil", "oregano", "thyme", "rosemary", "cilantro", "parsley",
        "dill", "mint", "sage", "tarragon", "chive", "chives",
        "cumin", "paprika", "turmeric", "cinnamon", "ginger",
        "nutmeg", "cardamom", "coriander", "saffron", "vanilla",
        "sriracha", "harissa", "chimichurri", "pesto", "tahini",
        "wasabi", "miso",

        // ── Cooking methods ──
        "baked", "roasted", "grilled", "fried", "sauteed", "braised",
        "steamed", "poached", "smoked", "broiled", "seared",
        "slow", "cooker", "instant", "pot", "skillet", "oven",
        "stovetop", "airfryer", "crockpot",
        "marinated", "glazed", "stuffed", "wrapped", "crusted",
        "blackened", "charred", "caramelized",

        // ── Dish types ──
        "soup", "stew", "chili", "curry", "casserole", "salad",
        "sandwich", "burger", "burgers", "wrap", "wraps", "taco",
        "tacos", "burrito", "burritos", "enchilada", "enchiladas",
        "pizza", "pie", "quiche", "frittata", "omelet", "omelette",
        "stir", "fry", "bowl", "bowls", "skewer", "skewers",
        "kebab", "kebabs", "satay", "dumpling", "dumplings",
        "spring", "roll", "rolls", "sushi", "ceviche", "tartare",
        "carpaccio", "bruschetta", "crostini",
        "cake", "cookies", "cookie", "brownie", "brownies",
        "muffin", "muffins", "cupcake", "cupcakes", "scone", "scones",
        "pancake", "pancakes", "waffle", "waffles", "crepe", "crepes",
        "pudding", "mousse", "tart", "galette", "crumble", "cobbler",
        "cheesecake", "tiramisu", "flan", "souffle",
        "cocktail", "smoothie", "lemonade", "margarita", "sangria",
        "sauce", "gravy", "dressing", "marinade", "vinaigrette",
        "salsa", "guacamole", "hummus", "dip",

        // ── Cuisine terms ──
        "italian", "mexican", "thai", "chinese", "indian", "japanese",
        "korean", "vietnamese", "french", "greek", "mediterranean",
        "moroccan", "ethiopian", "brazilian", "peruvian", "cajun",
        "creole", "southern", "texmex", "hawaiian", "caribbean",
        "middle", "eastern", "asian", "african", "european",
        "tuscan", "provencal", "szechuan", "sichuan", "cantonese",

        // ── Recipe-specific adjectives ──
        "easy", "quick", "simple", "best", "classic", "homemade",
        "healthy", "crispy", "creamy", "cheesy", "spicy", "savory",
        "sweet", "tangy", "smoky", "tender", "juicy", "flaky",
        "fluffy", "crunchy", "hearty", "comforting", "delicious",
        "ultimate", "perfect", "favorite", "traditional", "authentic",
        "copycat", "keto", "vegan", "vegetarian", "paleo",
        "gluten", "free", "dairy", "whole30", "lowcarb",
        "one", "sheet", "pan", "minute", "weeknight",
        "recipe", "recipes",
    ]

    /// Path segments that aren't meaningful for slug analysis.
    private static let nonContentSegments: Set<String> = [
        "article", "articles", "post", "posts", "blog", "news",
        "category", "categories", "tag", "tags", "page", "pages",
        "print", "share", "comments", "review", "reviews",
        "gallery", "photos", "video", "videos", "amp",
        "about", "contact", "search", "index",
    ]
}
