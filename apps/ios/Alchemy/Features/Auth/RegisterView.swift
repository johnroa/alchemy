import SwiftUI

/// Registration screen stub — mirrors SignInView layout with an additional name field.
///
/// No API calls in this scaffold. The register button sets isAuthenticated
/// immediately. When wired to Supabase, this will call
/// supabase.auth.signUp(email:password:) with user metadata.
struct RegisterView: View {
    @Binding var isAuthenticated: Bool
    @Binding var showRegister: Bool

    @State private var name = ""
    @State private var email = ""
    @State private var password = ""

    var body: some View {
        VStack(spacing: AlchemySpacing.xl) {
            Spacer()

            VStack(spacing: AlchemySpacing.sm) {
                Text("Create Account")
                    .font(AlchemyTypography.displayMedium)
                    .foregroundStyle(AlchemyColors.textPrimary)

                Text("Join Alchemy and start cooking")
                    .font(AlchemyTypography.bodySecondary)
                    .foregroundStyle(AlchemyColors.textSecondary)
            }

            Spacer()

            VStack(spacing: AlchemySpacing.lg) {
                TextField("Name", text: $name)
                    .textContentType(.name)
                    .padding(AlchemySpacing.lg)
                    .background(AlchemyColors.surface)
                    .clipShape(RoundedRectangle(cornerRadius: AlchemySpacing.buttonRadius))

                TextField("Email", text: $email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .padding(AlchemySpacing.lg)
                    .background(AlchemyColors.surface)
                    .clipShape(RoundedRectangle(cornerRadius: AlchemySpacing.buttonRadius))

                SecureField("Password", text: $password)
                    .textContentType(.newPassword)
                    .padding(AlchemySpacing.lg)
                    .background(AlchemyColors.surface)
                    .clipShape(RoundedRectangle(cornerRadius: AlchemySpacing.buttonRadius))
            }

            Button {
                isAuthenticated = true
            } label: {
                Text("Create Account")
                    .font(AlchemyTypography.subheading)
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, AlchemySpacing.md)
            }
            .buttonStyle(.borderedProminent)
            .tint(AlchemyColors.accent)
            .clipShape(RoundedRectangle(cornerRadius: AlchemySpacing.buttonRadius))

            Button {
                showRegister = false
            } label: {
                Text("Already have an account? **Sign in**")
                    .font(AlchemyTypography.bodySecondary)
                    .foregroundStyle(AlchemyColors.textSecondary)
            }

            Spacer()
        }
        .padding(.horizontal, AlchemySpacing.screenHorizontal * 1.5)
        .background(AlchemyColors.background)
    }
}
