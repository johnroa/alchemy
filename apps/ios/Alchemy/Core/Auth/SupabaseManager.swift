import Foundation
import Supabase

/// Singleton that initializes and holds the Supabase client.
///
/// Reads SUPABASE_URL and SUPABASE_ANON_KEY from Info.plist, which are
/// injected at build time via xcconfig files (Debug.xcconfig / Release.xcconfig).
/// A gitignored Local.xcconfig can override the placeholder values with real
/// credentials for local development.
@MainActor
final class SupabaseManager {
    static let shared = SupabaseManager()
    let client: SupabaseClient

    private init() {
        guard
            let urlString = Bundle.main.infoDictionary?["SUPABASE_URL"] as? String,
            !urlString.isEmpty,
            let url = URL(string: urlString),
            let anonKey = Bundle.main.infoDictionary?["SUPABASE_ANON_KEY"] as? String,
            !anonKey.isEmpty
        else {
            fatalError(
                "Missing Supabase credentials. "
                + "Create Configuration/Local.xcconfig with SUPABASE_URL and SUPABASE_ANON_KEY "
                + "(use the legacy anon key starting with 'eyJ' from the Supabase dashboard)."
            )
        }

        client = SupabaseClient(supabaseURL: url, supabaseKey: anonKey)
    }
}
