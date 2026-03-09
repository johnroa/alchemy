import CoreGraphics
import Nuke
import NukeUI
import SwiftUI

enum RecipeImageProfile: CaseIterable {
    case card
    case hero
    case fullScreenFeed

    fileprivate var fallbackSize: CGSize {
        switch self {
        case .card:
            CGSize(width: 220, height: 220)
        case .hero:
            CGSize(width: 430, height: 360)
        case .fullScreenFeed:
            CGSize(width: 430, height: 932)
        }
    }

    fileprivate var priority: ImageRequest.Priority {
        switch self {
        case .card:
            .normal
        case .hero, .fullScreenFeed:
            .high
        }
    }
}

enum RecipeImageRequestBuilder {
    static func makeRequest(
        url: URL?,
        profile: RecipeImageProfile,
        proposedSize: CGSize,
        scale: CGFloat
    ) -> ImageRequest? {
        guard let url else { return nil }

        let targetSize = normalizedSize(for: proposedSize, profile: profile)
        let normalizedScale = max(scale, 1)
        var userInfo: [ImageRequest.UserInfoKey: Any] = [
            .scaleKey: NSNumber(value: Float(normalizedScale)),
        ]

        switch profile {
        case .card:
            return ImageRequest(
                url: url,
                processors: [
                    ImageProcessors.Resize(
                        size: targetSize,
                        unit: .points,
                        contentMode: .aspectFill
                    ),
                ],
                priority: profile.priority,
                userInfo: userInfo
            )
        case .hero, .fullScreenFeed:
            userInfo[.thumbnailKey] = ImageRequest.ThumbnailOptions(
                size: targetSize,
                unit: .points,
                contentMode: .aspectFill
            )
            return ImageRequest(
                url: url,
                priority: profile.priority,
                userInfo: userInfo
            )
        }
    }

    private static func normalizedSize(
        for proposedSize: CGSize,
        profile: RecipeImageProfile
    ) -> CGSize {
        let fallback = profile.fallbackSize
        let width = proposedSize.width > 1 ? proposedSize.width : fallback.width
        let height = proposedSize.height > 1 ? proposedSize.height : fallback.height
        return CGSize(width: width, height: height)
    }
}

struct RecipeAsyncImage<Placeholder: View, Failure: View>: View {
    @Environment(\.displayScale) private var displayScale
    let url: URL?
    let profile: RecipeImageProfile
    var contentMode: ContentMode = .fill
    var transition: AnyTransition? = nil
    @ViewBuilder let placeholder: () -> Placeholder
    @ViewBuilder let failure: () -> Failure

    var body: some View {
        GeometryReader { proxy in
            content(for: proxy.size)
        }
    }

    @ViewBuilder
    private func content(for size: CGSize) -> some View {
        if let request = RecipeImageRequestBuilder.makeRequest(
            url: url,
            profile: profile,
            proposedSize: size,
            scale: displayScale
        ) {
            LazyImage(request: request) { state in
                if let image = state.image {
                    configuredImage(image)
                } else if state.error != nil {
                    failure()
                } else {
                    placeholder()
                }
            }
        } else {
            failure()
        }
    }

    @ViewBuilder
    private func configuredImage(_ image: Image) -> some View {
        let resized = image
            .resizable()
            .aspectRatio(contentMode: contentMode)

        if let transition {
            resized.transition(transition)
        } else {
            resized
        }
    }
}
