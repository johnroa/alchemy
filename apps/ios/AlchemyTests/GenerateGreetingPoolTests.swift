import XCTest
@testable import Alchemy

@MainActor
final class GenerateGreetingPoolTests: XCTestCase {
    func testCurrentGreetingReturnsFallbackForContext() {
        let date = makeDate(year: 2026, month: 3, day: 9, hour: 9)
        let greeting = GenerateGreetingPool.shared.currentGreeting(now: date)

        XCTAssertFalse(greeting.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }

    func testStoreRemoteGreetingPromotesHydratedGreeting() {
        let date = makeDate(year: 2026, month: 12, day: 12, hour: 19)
        let greeting = "Evening. Build me something bright and a little celebratory."

        GenerateGreetingPool.shared.storeRemoteGreeting(greeting, now: date)

        XCTAssertEqual(
            GenerateGreetingPool.shared.currentGreeting(now: date),
            greeting
        )
    }

    private func makeDate(year: Int, month: Int, day: Int, hour: Int) -> Date {
        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = day
        components.hour = hour
        components.minute = 0
        components.second = 0
        components.timeZone = TimeZone(secondsFromGMT: 0)
        return Calendar(identifier: .gregorian).date(from: components)!
    }
}
