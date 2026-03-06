import SwiftUI

/// Sign-in screen stub — dark themed email/password form.
///
/// No API calls in this scaffold. The sign-in button sets isAuthenticated
/// immediately. When wired to Supabase, this will call
/// supabase.auth.signIn(email:password:) and handle errors inline.
struct SignInView: View {
    @Binding var isAuthenticated: Bool
    @Binding var showRegister: Bool

    @State private var email = ""
    @State private var password = ""

    var body: some View {
        VStack(spacing: AlchemySpacing.xl) {
            Spacer()

            // App branding
            VStack(spacing: AlchemySpacing.sm) {
                Text("ALCHEMY")
                    .font(AlchemyTypography.displayLarge)
                    .foregroundStyle(AlchemyColors.textPrimary)
                    .kerning(6)

                Text("Cook with intelligence")
                    .font(AlchemyTypography.bodySecondary)
                    .foregroundStyle(AlchemyColors.textSecondary)
            }

            Spacer()

            // Form fields
            VStack(spacing: AlchemySpacing.lg) {
                TextField("Email", text: $email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .padding(AlchemySpacing.lg)
                    .background(AlchemyColors.surface)
                    .clipShape(RoundedRectangle(cornerRadius: AlchemySpacing.buttonRadius))

                SecureField("Password", text: $password)
                    .textContentType(.password)
                    .padding(AlchemySpacing.lg)
                    .background(AlchemyColors.surface)
                    .clipShape(RoundedRectangle(cornerRadius: AlchemySpacing.buttonRadius))
            }

            // Sign in button
            Button {
                isAuthenticated = true
            } label: {
                Text("Sign In")
                    .font(AlchemyTypography.subheading)
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, AlchemySpacing.md)
            }
            .buttonStyle(.borderedProminent)
            .tint(AlchemyColors.accent)
            .clipShape(RoundedRectangle(cornerRadius: AlchemySpacing.buttonRadius))

            // Register link
            Button {
                showRegister = true
            } label: {
                Text("Don't have an account? **Create one**")
                    .font(AlchemyTypography.bodySecondary)
                    .foregroundStyle(AlchemyColors.textSecondary)
            }

            Spacer()
        }
        .padding(.horizontal, AlchemySpacing.screenHorizontal * 1.5)
        .background(AlchemyColors.background)
    }
}
