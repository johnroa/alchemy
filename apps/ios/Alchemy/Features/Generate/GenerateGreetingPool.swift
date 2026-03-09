import Foundation

struct GenerateGreetingContext: Codable, Hashable {
    let timeBucket: String
    let eventKey: String

    static func current(now: Date = .now, calendar: Calendar = .current) -> GenerateGreetingContext {
        let hour = calendar.component(.hour, from: now)
        let month = calendar.component(.month, from: now)
        let weekday = calendar.component(.weekday, from: now)

        let timeBucket: String
        switch hour {
        case ..<12:
            timeBucket = "morning"
        case ..<17:
            timeBucket = "afternoon"
        default:
            timeBucket = "evening"
        }

        let eventKey: String
        if month == 12 {
            eventKey = "holiday"
        } else if weekday == 1 || weekday == 7 {
            eventKey = "weekend"
        } else {
            eventKey = "standard"
        }

        return GenerateGreetingContext(timeBucket: timeBucket, eventKey: eventKey)
    }
}

@MainActor
final class GenerateGreetingPool {

    static let shared = GenerateGreetingPool()

    private struct StoredPool: Codable {
        var entries: [String]
        var cursor: Int
        var updatedAt: Date
    }

    private let defaults = UserDefaults.standard
    private let storagePrefix = "generate.greeting.pool"
    private let freshnessWindow: TimeInterval = 6 * 60 * 60
    private let maxEntries = 6

    private init() {}

    func currentGreeting(now: Date = .now) -> String {
        let context = GenerateGreetingContext.current(now: now)
        let key = storageKey(for: context)
        var pool = loadPool(for: key, now: now) ?? StoredPool(
            entries: fallbackEntries(for: context),
            cursor: 0,
            updatedAt: now
        )

        if pool.entries.isEmpty {
            pool.entries = fallbackEntries(for: context)
        }

        let index = min(max(pool.cursor, 0), max(pool.entries.count - 1, 0))
        let greeting = pool.entries[index]
        pool.cursor = pool.entries.isEmpty ? 0 : (index + 1) % pool.entries.count
        savePool(pool, for: key)
        return greeting
    }

    func storeRemoteGreeting(_ text: String, now: Date = .now) {
        let normalized = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty else { return }

        let context = GenerateGreetingContext.current(now: now)
        let key = storageKey(for: context)
        var pool = loadPool(for: key, now: now) ?? StoredPool(
            entries: fallbackEntries(for: context),
            cursor: 0,
            updatedAt: now
        )

        var entries = pool.entries.filter {
            $0.caseInsensitiveCompare(normalized) != .orderedSame
        }
        entries.insert(normalized, at: 0)
        if entries.count > maxEntries {
            entries = Array(entries.prefix(maxEntries))
        }

        pool.entries = entries
        pool.cursor = 0
        pool.updatedAt = now
        savePool(pool, for: key)
    }

    private func storageKey(for context: GenerateGreetingContext) -> String {
        "\(storagePrefix).\(context.timeBucket).\(context.eventKey)"
    }

    private func loadPool(for key: String, now: Date) -> StoredPool? {
        guard let data = defaults.data(forKey: key) else { return nil }
        guard let pool = try? JSONDecoder().decode(StoredPool.self, from: data) else { return nil }
        guard now.timeIntervalSince(pool.updatedAt) < freshnessWindow else { return nil }
        return pool
    }

    private func savePool(_ pool: StoredPool, for key: String) {
        guard let data = try? JSONEncoder().encode(pool) else { return }
        defaults.set(data, forKey: key)
    }

    private func fallbackEntries(for context: GenerateGreetingContext) -> [String] {
        switch (context.timeBucket, context.eventKey) {
        case ("morning", "holiday"):
            return [
                "Morning. Want something cozy and bright today?",
                "Good morning. I can build something festive without making it fussy.",
                "Morning. What sounds right today: comforting, fresh, or a little celebratory?"
            ]
        case ("morning", "weekend"):
            return [
                "Morning. Want to make something worth a slow start?",
                "Good morning. I can keep it easy or turn brunch into an event.",
                "Morning. What are you in the mood for today?"
            ]
        case ("afternoon", "weekend"):
            return [
                "Afternoon. Want a laid-back recipe or something a little showier?",
                "Afternoon. I can help you make dinner plans before the day gets away from you.",
                "Afternoon. Tell me what sounds good and I'll shape the rest."
            ]
        case ("evening", "holiday"):
            return [
                "Evening. Want something celebratory without turning it into a project?",
                "Tonight feels like a good night for a little drama on the plate.",
                "Evening. I can make this feel special and still keep it doable."
            ]
        case ("evening", "weekend"):
            return [
                "Evening. Want a relaxed dinner or a proper centerpiece?",
                "Tonight is wide open. I can keep it easy or make it feel like a plan.",
                "Evening. What kind of dinner are we building?"
            ]
        case ("afternoon", _):
            return [
                "Afternoon. Want to land on dinner now before it becomes a scramble?",
                "Afternoon. Tell me the vibe and I'll shape the recipe around it.",
                "Afternoon. I can keep this practical, ambitious, or somewhere in between."
            ]
        case ("evening", _):
            return [
                "Evening. What sounds good tonight?",
                "Tonight, I can keep dinner quick or make it feel a little special.",
                "Evening. Tell me what you're craving and I'll take it from there."
            ]
        default:
            return [
                "Morning. What sounds good today?",
                "Good morning. I can shape something easy, bright, or comforting.",
                "Morning. Tell me what you're in the mood for and I'll build from there."
            ]
        }
    }
}
