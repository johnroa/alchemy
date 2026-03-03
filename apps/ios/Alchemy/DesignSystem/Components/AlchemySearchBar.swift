import SwiftUI

struct AlchemySearchBar: View {
    @Binding var text: String
    var placeholder: String = "Search"
    var onSubmit: (() -> Void)?

    @FocusState private var isFocused: Bool

    var body: some View {
        HStack(spacing: Spacing.sm2) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(isFocused ? AlchemyColors.gold : AlchemyColors.grey1)

            TextField(placeholder, text: $text)
                .font(AlchemyFont.titleSM)
                .foregroundStyle(AlchemyColors.textPrimary)
                .tint(AlchemyColors.gold)
                .focused($isFocused)
                .onSubmit { onSubmit?() }
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)

            if !text.isEmpty {
                Button {
                    withAnimation(.spring(response: 0.25)) {
                        text = ""
                    }
                    Haptics.fire(.light)
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 16))
                        .foregroundStyle(AlchemyColors.grey1)
                }
                .transition(.scale.combined(with: .opacity))
            }
        }
        .padding(.horizontal, Spacing.md)
        .frame(height: Sizing.searchBarHeight)
        .background(AlchemyColors.dark)
        .clipShape(RoundedRectangle(cornerRadius: Radius.lg))
        .overlay(
            RoundedRectangle(cornerRadius: Radius.lg)
                .stroke(
                    isFocused ? AlchemyColors.grey2.opacity(0.3) : Color.clear,
                    lineWidth: 1
                )
        )
        .animation(.easeInOut(duration: 0.2), value: isFocused)
    }
}

#if DEBUG
#Preview("Search Bar") {
    @Previewable @State var query = ""

    AlchemySearchBar(text: $query)
        .padding()
        .background(AlchemyColors.deepDark)
        .preferredColorScheme(.dark)
}
#endif
