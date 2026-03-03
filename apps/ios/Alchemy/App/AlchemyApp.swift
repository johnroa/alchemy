import SwiftUI
import Supabase

@main
struct AlchemyApp: App {
    private let supabaseClient: SupabaseClient
    @State private var authManager: AuthManager
    @State private var apiClient: APIClient

    init() {
        let client = SupabaseClient(
            supabaseURL: URL(string: AppEnvironment.supabaseURL)!,
            supabaseKey: AppEnvironment.supabaseAnonKey
        )
        self.supabaseClient = client
        self._authManager = State(initialValue: AuthManager(supabaseClient: client))
        self._apiClient = State(initialValue: APIClient(supabaseClient: client))
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(authManager)
                .environment(apiClient)
                .preferredColorScheme(.dark)
        }
    }
}
