import Foundation

enum AppEnvironment {
    static var apiBaseURL: String {
        guard let value = Bundle.main.infoDictionary?["API_BASE_URL"] as? String,
              !value.isEmpty else {
            return "https://api.cookwithalchemy.com/v1"
        }
        return value
    }

    static var supabaseURL: String {
        guard let value = Bundle.main.infoDictionary?["SUPABASE_URL"] as? String,
              !value.isEmpty else {
            fatalError("SUPABASE_URL not set in xcconfig")
        }
        return value
    }

    static var supabaseAnonKey: String {
        guard let value = Bundle.main.infoDictionary?["SUPABASE_ANON_KEY"] as? String,
              !value.isEmpty else {
            fatalError("SUPABASE_ANON_KEY not set in xcconfig")
        }
        return value
    }
}
