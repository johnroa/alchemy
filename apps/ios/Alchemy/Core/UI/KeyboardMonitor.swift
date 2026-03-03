import SwiftUI
import Combine
import UIKit

@MainActor
final class KeyboardMonitor: ObservableObject {
    @Published private(set) var height: CGFloat = 0
    @Published private(set) var isVisible = false

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
        let visible = keyboardHeight > 8

        if abs(height - keyboardHeight) < 0.5 && isVisible == visible {
            return
        }

        let animation: Animation
        switch Int(curveRaw) {
        case UIView.AnimationCurve.easeIn.rawValue:
            animation = .easeIn(duration: duration)
        case UIView.AnimationCurve.easeOut.rawValue:
            animation = .easeOut(duration: duration)
        case UIView.AnimationCurve.linear.rawValue:
            animation = .linear(duration: duration)
        default:
            animation = .easeInOut(duration: duration)
        }

        if duration <= 0.01 {
            height = keyboardHeight
            isVisible = visible
            return
        }

        withAnimation(animation) {
            height = keyboardHeight
            isVisible = visible
        }
    }

    private static func keyboardHeight(from endFrame: CGRect) -> CGFloat {
        let windowBounds = keyWindow()?.bounds ?? UIScreen.main.bounds
        let intersection = windowBounds.intersection(endFrame)
        if intersection.isNull || intersection.height <= 0 {
            return 0
        }

        let adjusted = intersection.height - bottomSafeInset()
        return max(0, adjusted)
    }

    private static func keyWindow() -> UIWindow? {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first(where: \.isKeyWindow)
    }

    private static func bottomSafeInset() -> CGFloat {
        keyWindow()?.safeAreaInsets.bottom ?? 0
    }
}
