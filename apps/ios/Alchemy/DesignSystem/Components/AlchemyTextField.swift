import SwiftUI

struct AlchemyTextField: View {
    let placeholder: String
    @Binding var text: String
    var icon: String?
    var isSecure: Bool = false
    var errorMessage: String?
    var onSubmit: (() -> Void)?

    @FocusState private var isFocused: Bool
    @State private var showSecureText = false

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack(spacing: Spacing.sm2) {
                if let icon {
                    Image(systemName: icon)
                        .font(.system(size: 16))
                        .foregroundStyle(isFocused ? AlchemyColors.gold : AlchemyColors.grey1)
                        .frame(width: 24)
                }

                if isSecure && !showSecureText {
                    SecureField(placeholder, text: $text)
                        .font(AlchemyFont.body)
                        .foregroundStyle(AlchemyColors.textPrimary)
                        .tint(AlchemyColors.gold)
                        .focused($isFocused)
                        .onSubmit { onSubmit?() }
                } else {
                    TextField(placeholder, text: $text)
                        .font(AlchemyFont.body)
                        .foregroundStyle(AlchemyColors.textPrimary)
                        .tint(AlchemyColors.gold)
                        .focused($isFocused)
                        .onSubmit { onSubmit?() }
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                }

                if isSecure {
                    Button {
                        showSecureText.toggle()
                        Haptics.fire(.light)
                    } label: {
                        Image(systemName: showSecureText ? "eye.slash" : "eye")
                            .font(.system(size: 15))
                            .foregroundStyle(AlchemyColors.grey1)
                    }
                }
            }
            .padding(.horizontal, Spacing.md)
            .frame(height: Sizing.fieldHeight)
            .background(AlchemyColors.deepDark)
            .clipShape(RoundedRectangle(cornerRadius: Radius.sm))
            .overlay(
                RoundedRectangle(cornerRadius: Radius.sm)
                    .stroke(
                        errorMessage != nil ? AlchemyColors.danger.opacity(0.5) :
                            isFocused ? AlchemyColors.grey2.opacity(0.4) :
                            AlchemyColors.dark,
                        lineWidth: 2
                    )
            )
            .animation(.easeInOut(duration: 0.2), value: isFocused)

            if let errorMessage {
                Text(errorMessage)
                    .font(AlchemyFont.captionLight)
                    .foregroundStyle(AlchemyColors.danger)
                    .padding(.leading, Spacing.sm)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }
}

#if DEBUG
#Preview("Text Fields") {
    @Previewable @State var email = ""
    @Previewable @State var password = ""

    VStack(spacing: 16) {
        AlchemyTextField(placeholder: "Email", text: $email, icon: "envelope")
        AlchemyTextField(placeholder: "Password", text: $password, icon: "lock", isSecure: true)
        AlchemyTextField(placeholder: "With Error", text: $email, icon: "exclamationmark.triangle", errorMessage: "This field is required")
    }
    .padding()
    .background(AlchemyColors.deepDark)
    .preferredColorScheme(.dark)
}
#endif
