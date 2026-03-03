import SwiftUI

@Observable
final class SignInViewModel {
    var email = ""
    var password = ""
    var errorMessage: String?
    var isLoading = false

    var isValid: Bool {
        !email.trimmingCharacters(in: .whitespaces).isEmpty && password.count >= 6
    }

    func signIn(auth: AuthManager) async {
        guard isValid else { return }
        isLoading = true
        errorMessage = nil

        let result = await auth.signIn(
            email: email.trimmingCharacters(in: .whitespaces).lowercased(),
            password: password
        )

        isLoading = false
        if let error = result {
            errorMessage = error
        }
    }
}
