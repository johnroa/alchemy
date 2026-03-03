import SwiftUI

struct SignInView: View {
    @Environment(AuthManager.self) private var auth
    @Binding var showRegister: Bool
    @State private var vm = SignInViewModel()
    @FocusState private var focusedField: Field?

    private enum Field: Hashable {
        case email, password
    }

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 220)

            VStack(spacing: Spacing.sm) {
                AlchemyTextField(
                    placeholder: "E-mail",
                    text: $vm.email,
                    onSubmit: { focusedField = .password }
                )
                .focused($focusedField, equals: .email)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.emailAddress)
                .textContentType(.emailAddress)

                AlchemyTextField(
                    placeholder: "Password",
                    text: $vm.password,
                    isSecure: true,
                    onSubmit: { Task { await vm.signIn(auth: auth) } }
                )
                .focused($focusedField, equals: .password)
                .textContentType(.password)

                if let error = vm.errorMessage {
                    Text(error)
                        .font(AlchemyFont.captionSmall)
                        .foregroundStyle(AlchemyColors.danger)
                        .multilineTextAlignment(.center)
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }
            }
            .padding(.horizontal, Spacing.lg)

            AlchemyButton(title: "Sign in", isLoading: vm.isLoading) {
                Task { await vm.signIn(auth: auth) }
            }
            .disabled(!vm.isValid)
            .padding(.horizontal, Spacing.lg)
            .padding(.top, Spacing.lg)

            Spacer().frame(height: 64)

            Text("Don’t have an account?")
                .font(AlchemyFont.body)
                .foregroundStyle(AlchemyColors.textTertiary)
                .padding(.top, Spacing.md)

            AlchemyButton(title: "Register", isLoading: false) {
                withAnimation { showRegister = true }
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.top, Spacing.lg)

            Spacer()
        }
        .onAppear { focusedField = .email }
    }
}
