import Foundation
import ImageIO
import UIKit

enum ImageDownsamplerError: Error {
    case invalidImageSource
    case thumbnailCreationFailed
    case jpegEncodingFailed
}

struct DownsampledImagePayload {
    let previewImage: UIImage
    let jpegData: Data
}

enum ImageDownsampler {
    static let importMaxPixelSize = 2_048
    private static let defaultCompressionQuality: CGFloat = 0.85

    static func downsampledJPEGData(
        from data: Data,
        maxPixelSize: Int = importMaxPixelSize,
        compressionQuality: CGFloat = defaultCompressionQuality
    ) throws -> Data {
        guard let source = CGImageSourceCreateWithData(data as CFData, imageSourceOptions()) else {
            throw ImageDownsamplerError.invalidImageSource
        }
        return try makeJPEGData(
            from: source,
            maxPixelSize: maxPixelSize,
            compressionQuality: compressionQuality
        )
    }

    static func downsampledJPEGData(
        fromFileAt url: URL,
        maxPixelSize: Int = importMaxPixelSize,
        compressionQuality: CGFloat = defaultCompressionQuality
    ) throws -> Data {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, imageSourceOptions()) else {
            throw ImageDownsamplerError.invalidImageSource
        }
        return try makeJPEGData(
            from: source,
            maxPixelSize: maxPixelSize,
            compressionQuality: compressionQuality
        )
    }

    static func downsampleImageData(
        _ data: Data,
        maxPixelSize: Int = importMaxPixelSize,
        compressionQuality: CGFloat = defaultCompressionQuality
    ) throws -> DownsampledImagePayload {
        let jpegData = try downsampledJPEGData(
            from: data,
            maxPixelSize: maxPixelSize,
            compressionQuality: compressionQuality
        )
        guard let previewImage = UIImage(data: jpegData) else {
            throw ImageDownsamplerError.invalidImageSource
        }
        return DownsampledImagePayload(previewImage: previewImage, jpegData: jpegData)
    }

    static func downsampleImageFile(
        at url: URL,
        maxPixelSize: Int = importMaxPixelSize,
        compressionQuality: CGFloat = defaultCompressionQuality
    ) throws -> DownsampledImagePayload {
        let jpegData = try downsampledJPEGData(
            fromFileAt: url,
            maxPixelSize: maxPixelSize,
            compressionQuality: compressionQuality
        )
        guard let previewImage = UIImage(data: jpegData) else {
            throw ImageDownsamplerError.invalidImageSource
        }
        return DownsampledImagePayload(previewImage: previewImage, jpegData: jpegData)
    }

    static func downsampleImage(
        _ image: UIImage,
        maxPixelSize: Int = importMaxPixelSize,
        compressionQuality: CGFloat = defaultCompressionQuality
    ) throws -> DownsampledImagePayload {
        guard let data = image.jpegData(compressionQuality: compressionQuality) else {
            throw ImageDownsamplerError.jpegEncodingFailed
        }
        let jpegData = try downsampledJPEGData(
            from: data,
            maxPixelSize: maxPixelSize,
            compressionQuality: compressionQuality
        )
        guard let previewImage = UIImage(data: jpegData) else {
            throw ImageDownsamplerError.invalidImageSource
        }
        return DownsampledImagePayload(previewImage: previewImage, jpegData: jpegData)
    }

    private static func makeJPEGData(
        from source: CGImageSource,
        maxPixelSize: Int,
        compressionQuality: CGFloat
    ) throws -> Data {
        let options: CFDictionary = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCache: false,
            kCGImageSourceShouldCacheImmediately: false,
            kCGImageSourceThumbnailMaxPixelSize: max(maxPixelSize, 1),
        ] as CFDictionary

        guard let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, options) else {
            throw ImageDownsamplerError.thumbnailCreationFailed
        }

        let previewImage = UIImage(cgImage: cgImage)
        guard let jpegData = previewImage.jpegData(compressionQuality: compressionQuality) else {
            throw ImageDownsamplerError.jpegEncodingFailed
        }
        return jpegData
    }

    private static func imageSourceOptions() -> CFDictionary {
        [
            kCGImageSourceShouldCache: false,
            kCGImageSourceShouldCacheImmediately: false,
        ] as CFDictionary
    }
}
