import SwiftUI

/// Root entry point for Alchemy.
/// Forces dark mode app-wide since the design is dark-only.
@main
struct AlchemyApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .preferredColorScheme(.dark)
        }
    }
}
