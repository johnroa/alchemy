import SwiftUI

struct RegisterView: View {
    @Environment(AuthManager.self) private var auth
    @Binding var showRegister: Bool
    @State private var vm = RegisterViewModel()
    @FocusState private var focusedField: Field?

    private enum Field: Hashable {
        case email, password, confirm
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
                    onSubmit: { focusedField = .confirm }
                )
                .focused($focusedField, equals: .password)
                .textContentType(.newPassword)

                AlchemyTextField(
                    placeholder: "Confirm Password",
                    text: $vm.confirmPassword,
                    isSecure: true,
                    errorMessage: vm.passwordMismatch ? "Passwords don't match" : nil,
                    onSubmit: { Task { await vm.register(auth: auth) } }
                )
                .focused($focusedField, equals: .confirm)
                .textContentType(.newPassword)

                if let error = vm.errorMessage {
                    Text(error)
                        .font(AlchemyFont.captionSmall)
                        .foregroundStyle(AlchemyColors.danger)
                        .multilineTextAlignment(.center)
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }
            }
            .padding(.horizontal, Spacing.lg)

            AlchemyButton(title: "Register", isLoading: vm.isLoading) {
                Task { await vm.register(auth: auth) }
            }
            .disabled(!vm.isValid)
            .padding(.horizontal, Spacing.lg)
            .padding(.top, Spacing.lg)

            Spacer().frame(height: 64)

            Text("Already have an account?")
                .font(AlchemyFont.body)
                .foregroundStyle(AlchemyColors.textTertiary)
                .padding(.top, Spacing.md)

            AlchemyButton(title: "Sign in") {
                withAnimation { showRegister = false }
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.top, Spacing.lg)

            Spacer()
        }
        .onAppear { focusedField = .email }
    }
}
