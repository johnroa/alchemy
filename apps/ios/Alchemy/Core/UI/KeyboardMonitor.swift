import SwiftUI
import Combine
import UIKit

@MainActor
final class KeyboardMonitor: ObservableObject {
    @Published private(set) var height: CGFloat = 0
    @Published private(set) var isVisible = false
    /// The keyboard's top edge in screen coordinates (or screen bottom when hidden).
    @Published private(set) var topY: CGFloat = UIScreen.main.bounds.height

    private var cancellables = Set<AnyCancellable>()

    init() {
        let willChange = NotificationCenter.default.publisher(
            for: UIResponder.keyboardWillChangeFrameNotification
        )
        let willHide = NotificationCenter.default.publisher(
            for: UIResponder.keyboardWillHideNotification
        )

        willChange
            .merge(with: willHide)
            .sink { [weak self] notification in
                self?.handle(notification)
            }
            .store(in: &cancellables)
    }

    private func handle(_ notification: Notification) {
        let userInfo = notification.userInfo ?? [:]
        let endFrame = (userInfo[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect) ?? .zero
        let duration = (userInfo[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double) ?? 0.25
        let curveRaw = (userInfo[UIResponder.keyboardAnimationCurveUserInfoKey] as? UInt) ?? UInt(UIView.AnimationCurve.easeInOut.rawValue)

        let keyboardHeight = Self.keyboardHeight(from: endFrame)
        let keyboardTopY = endFrame.origin.y
        let visible = keyboardHeight > 8

        if abs(height - keyboardHeight) < 0.5 && isVisible == visible {
            return
        }

        // Visibility is updated immediately so dependent UI (tab bar/composer) can
        // react before the keyboard animation completes.
        isVisible = visible

        if duration <= 0.01 {
            height = keyboardHeight
            topY = keyboardTopY
            #if DEBUG
            print("[KeyboardMonitor] immediate height=\(keyboardHeight) visible=\(visible) endFrame=\(NSCoder.string(for: endFrame))")
            #endif
            return
        }

        // Use UIViewPropertyAnimator with the EXACT keyboard animation curve.
        // This creates a Core Animation transaction that SwiftUI inherits,
        // so any SwiftUI view reading `height` animates in perfect sync with
        // the system keyboard — no approximation, no lag.
        let curve = UIView.AnimationCurve(rawValue: Int(curveRaw)) ?? .easeInOut
        let animator = UIViewPropertyAnimator(duration: duration, curve: curve) {
            self.height = keyboardHeight
            self.topY = keyboardTopY
        }
        animator.startAnimation()

        #if DEBUG
        print("[KeyboardMonitor] animated height=\(keyboardHeight) visible=\(visible) curve=\(curveRaw) endFrame=\(NSCoder.string(for: endFrame))")
        #endif
    }

    /// Raw keyboard intersection height — NOT adjusted for safe area.
    /// Callers positioned from the actual screen bottom (past safe area)
    /// need the full value; those inside the safe area should subtract
    /// `safeAreaBottom` themselves.
    private static func keyboardHeight(from endFrame: CGRect) -> CGFloat {
        let windowBounds = keyWindow()?.bounds ?? UIScreen.main.bounds
        let intersection = windowBounds.intersection(endFrame)
        if intersection.isNull || intersection.height <= 0 {
            return 0
        }
        return intersection.height
    }

    private static func keyWindow() -> UIWindow? {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first(where: \.isKeyWindow)
    }

}
