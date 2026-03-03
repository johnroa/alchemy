import SwiftUI
import NukeUI

struct AlchemyRecipeCard: View {
    let title: String
    let summary: String
    var imageURL: String?
    var category: String?
    var matchedID: Namespace.ID?

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            // Image or placeholder
            if let imageURL, let url = URL(string: imageURL) {
                LazyImage(url: url) { state in
                    if let image = state.image {
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                    } else if state.isLoading {
                        AlchemyColors.card
                            .shimmer()
                    } else {
                        placeholderView
                    }
                }
            } else {
                placeholderView
            }

            // Gradient overlay
            AlchemyColors.cardGradient

            // Text content
            VStack(alignment: .leading, spacing: Spacing.xs) {
                if let category {
                    Text(category)
                        .font(AlchemyFont.caption)
                        .foregroundStyle(AlchemyColors.grey4)
                        .textCase(.uppercase)
                        .tracking(0.8)
                }

                Text(title)
                    .font(AlchemyFont.bodyBold)
                    .foregroundStyle(.white)
                    .lineLimit(2)

                Text(summary)
                    .font(AlchemyFont.micro)
                    .foregroundStyle(AlchemyColors.grey4)
                    .lineLimit(2)
            }
            .padding(Spacing.md)
        }
        .aspectRatio(Sizing.recipeCardAspect, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: Radius.lg))
        .overlay(
            RoundedRectangle(cornerRadius: Radius.lg)
                .stroke(Color.white.opacity(0.12), lineWidth: 0.5)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(title). \(summary)")
    }


    private var placeholderView: some View {
        ZStack {
            AlchemyColors.card
            Image(systemName: "fork.knife")
                .font(.system(size: 32))
                .foregroundStyle(AlchemyColors.grey1.opacity(0.5))
        }
    }
}

#if DEBUG
#Preview("Recipe Card") {
    VStack(spacing: 16) {
        AlchemyRecipeCard(
            title: PreviewData.recipeCards[0].title,
            summary: PreviewData.recipeCards[0].summary,
            category: PreviewData.recipeCards[0].category
        )
        .frame(width: 180)

        AlchemyRecipeCard(
            title: PreviewData.recipeCards[1].title,
            summary: PreviewData.recipeCards[1].summary,
            category: PreviewData.recipeCards[1].category
        )
        .frame(width: 180)
    }
    .padding()
    .background(AlchemyColors.deepDark)
    .preferredColorScheme(.dark)
}
#endif
