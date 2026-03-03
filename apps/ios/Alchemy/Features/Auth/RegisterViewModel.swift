import SwiftUI

@Observable
final class RegisterViewModel {
    var email = ""
    var password = ""
    var confirmPassword = ""
    var errorMessage: String?
    var isLoading = false

    var isValid: Bool {
        !email.trimmingCharacters(in: .whitespaces).isEmpty
            && password.count >= 6
            && password == confirmPassword
    }

    var passwordMismatch: Bool {
        !confirmPassword.isEmpty && password != confirmPassword
    }

    func register(auth: AuthManager) async {
        guard isValid else { return }
        isLoading = true
        errorMessage = nil

        let result = await auth.signUp(
            email: email.trimmingCharacters(in: .whitespaces).lowercased(),
            password: password
        )

        isLoading = false
        if let message = result {
            errorMessage = message
        }
    }
}
