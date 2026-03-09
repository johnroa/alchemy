import ImageIO
import UniformTypeIdentifiers
import UIKit
import XCTest
@testable import Alchemy

final class ImageDownsamplerTests: XCTestCase {
    func testDownsampleImageDataBoundsLargestDimension() throws {
        let originalData = try makeJPEGData(size: CGSize(width: 4_000, height: 3_000))

        let payload = try ImageDownsampler.downsampleImageData(
            originalData,
            maxPixelSize: 512,
            compressionQuality: 0.8
        )

        XCTAssertLessThanOrEqual(max(payload.previewImage.size.width, payload.previewImage.size.height), 512.0)
        XCTAssertFalse(payload.jpegData.isEmpty)
    }

    func testDownsampleImageDataAppliesOrientationTransform() throws {
        let originalData = try makeJPEGData(
            size: CGSize(width: 640, height: 320),
            orientation: 6
        )

        let payload = try ImageDownsampler.downsampleImageData(
            originalData,
            maxPixelSize: 640
        )

        XCTAssertGreaterThan(payload.previewImage.size.height, payload.previewImage.size.width)
        XCTAssertEqual(payload.previewImage.imageOrientation, .up)
    }

    func testDownsampleImageProducesJPEGDataFromUIImageInput() throws {
        let originalData = try makeJPEGData(size: CGSize(width: 1_200, height: 800))
        let image = UIImage(data: originalData)

        XCTAssertNotNil(image)

        let payload = try ImageDownsampler.downsampleImage(
            XCTUnwrap(image),
            maxPixelSize: 400
        )

        XCTAssertFalse(payload.jpegData.isEmpty)
        XCTAssertLessThanOrEqual(max(payload.previewImage.size.width, payload.previewImage.size.height), 400.0)
    }

    private func makeJPEGData(
        size: CGSize,
        orientation: Int = 1
    ) throws -> Data {
        let renderer = UIGraphicsImageRenderer(size: size)
        let image = renderer.image { context in
            UIColor.systemOrange.setFill()
            context.fill(CGRect(origin: .zero, size: size))
        }

        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(
            output,
            UTType.jpeg.identifier as CFString,
            1,
            nil
        ) else {
            XCTFail("Failed to create image destination")
            throw ImageDownsamplerError.jpegEncodingFailed
        }

        CGImageDestinationAddImage(
            destination,
            try XCTUnwrap(image.cgImage),
            [
                kCGImagePropertyOrientation: orientation,
            ] as CFDictionary
        )
        XCTAssertTrue(CGImageDestinationFinalize(destination))
        return output as Data
    }
}
