import SwiftUI
import Sentry

/// Root entry point for Alchemy.
/// Forces dark mode app-wide since the design is dark-only.
@main
struct AlchemyApp: App {
    init() {
        SentryBootstrap.startIfConfigured()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .preferredColorScheme(.dark)
        }
    }
}

private enum SentryBootstrap {
    static func startIfConfigured() {
        guard let dsn = sanitizedString(for: "SENTRY_DSN") else {
            return
        }

        let tracesSampleRate = sanitizedDouble(for: "SENTRY_TRACES_SAMPLE_RATE")
#if DEBUG
        let environment = "debug"
        let fallbackTraceRate = 1.0
#else
        let environment = "release"
        let fallbackTraceRate = 0.2
#endif

        let release = sanitizedString(for: "CFBundleShortVersionString")
        let dist = sanitizedString(for: "CFBundleVersion")

        SentrySDK.start { options in
            options.dsn = dsn
            options.environment = environment
            options.releaseName = release
            options.dist = dist
            options.tracesSampleRate = NSNumber(value: tracesSampleRate ?? fallbackTraceRate)
            options.enableMetricKit = true
            options.enableAppHangTracking = true
            options.attachScreenshot = false
            options.attachViewHierarchy = false
        }
    }

    private static func sanitizedString(for key: String) -> String? {
        guard let rawValue = Bundle.main.object(forInfoDictionaryKey: key) as? String else {
            return nil
        }

        let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.hasPrefix("$(") else {
            return nil
        }

        return trimmed
    }

    private static func sanitizedDouble(for key: String) -> Double? {
        guard let rawValue = sanitizedString(for: key) else {
            return nil
        }

        let numericValue = Double(rawValue)
        return numericValue.flatMap { value in
            guard value >= 0 else { return nil }
            return value
        }
    }
}
