import XCTest
import Nuke
@testable import Alchemy

final class RecipeImageLoadingTests: XCTestCase {
    func testCardProfileUsesResizeProcessor() {
        let request = RecipeImageRequestBuilder.makeRequest(
            url: URL(string: "https://example.com/card.jpg"),
            profile: .card,
            proposedSize: CGSize(width: 120, height: 80),
            scale: 3
        )

        XCTAssertNotNil(request)
        XCTAssertEqual(request?.priority, .normal)
        XCTAssertEqual(request?.processors.count, 1)
        XCTAssertNil(request?.userInfo[.thumbnailKey])
        XCTAssertEqual(request?.userInfo[.scaleKey] as? NSNumber, NSNumber(value: 3))
    }

    func testHeroProfileUsesThumbnailOptions() {
        let request = RecipeImageRequestBuilder.makeRequest(
            url: URL(string: "https://example.com/hero.jpg"),
            profile: .hero,
            proposedSize: CGSize(width: 390, height: 320),
            scale: 2
        )

        XCTAssertNotNil(request)
        XCTAssertEqual(request?.priority, .high)
        XCTAssertTrue(request?.processors.isEmpty == true)
        XCTAssertNotNil(request?.userInfo[.thumbnailKey] as? ImageRequest.ThumbnailOptions)
        XCTAssertEqual(request?.userInfo[.scaleKey] as? NSNumber, NSNumber(value: 2))
    }

    func testFullScreenFeedProfileFallsBackWhenSizeUnavailable() {
        let request = RecipeImageRequestBuilder.makeRequest(
            url: URL(string: "https://example.com/feed.jpg"),
            profile: .fullScreenFeed,
            proposedSize: .zero,
            scale: 2
        )

        let options = request?.userInfo[.thumbnailKey] as? ImageRequest.ThumbnailOptions

        XCTAssertNotNil(request)
        XCTAssertNotNil(options)
        XCTAssertTrue(request?.processors.isEmpty == true)
    }
}
