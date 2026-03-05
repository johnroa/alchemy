import SwiftUI
import UIKit

/// A UIKit-backed multi-line text input that does NOT trigger SwiftUI's
/// automatic keyboard avoidance (view shifting). SwiftUI's TextField/TextEditor
/// cause the entire view hierarchy to shift up when focused — this wrapper
/// avoids that by using UITextView directly.
struct ComposerTextView: UIViewRepresentable {
    @Binding var text: String
    @Binding var isFocused: Bool
    var placeholder: String = ""
    var font: UIFont = .systemFont(ofSize: 16)
    var textColor: UIColor = .white
    var tintColor: UIColor = .systemYellow
    var placeholderColor: UIColor = UIColor.white.withAlphaComponent(0.56)
    var maxLines: Int = 6

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeUIView(context: Context) -> UITextView {
        let tv = UITextView()
        tv.delegate = context.coordinator
        tv.backgroundColor = .clear
        tv.font = font
        tv.textColor = textColor
        tv.tintColor = tintColor
        tv.textContainerInset = UIEdgeInsets(top: 0, left: 0, bottom: 0, right: 0)
        tv.textContainer.lineFragmentPadding = 0
        tv.textContainer.maximumNumberOfLines = maxLines
        tv.textContainer.lineBreakMode = .byWordWrapping
        tv.isScrollEnabled = false
        tv.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        tv.setContentHuggingPriority(.defaultLow, for: .horizontal)

        let label = UILabel()
        label.text = placeholder
        label.font = font
        label.textColor = placeholderColor
        label.numberOfLines = 1
        label.tag = 999
        label.translatesAutoresizingMaskIntoConstraints = false
        tv.addSubview(label)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: tv.layoutMarginsGuide.leadingAnchor),
            label.topAnchor.constraint(equalTo: tv.topAnchor),
        ])

        return tv
    }

    func updateUIView(_ tv: UITextView, context: Context) {
        if tv.text != text {
            tv.text = text
        }
        if let label = tv.viewWithTag(999) as? UILabel {
            label.isHidden = !text.isEmpty
        }
        // Sync focus state
        if isFocused && !tv.isFirstResponder {
            DispatchQueue.main.async { tv.becomeFirstResponder() }
        } else if !isFocused && tv.isFirstResponder {
            DispatchQueue.main.async { tv.resignFirstResponder() }
        }
    }

    class Coordinator: NSObject, UITextViewDelegate {
        var parent: ComposerTextView

        init(_ parent: ComposerTextView) {
            self.parent = parent
        }

        func textViewDidChange(_ textView: UITextView) {
            parent.text = textView.text ?? ""
            if let label = textView.viewWithTag(999) as? UILabel {
                label.isHidden = !(textView.text ?? "").isEmpty
            }
            // Force SwiftUI layout update for height changes
            textView.invalidateIntrinsicContentSize()
        }

        func textViewDidBeginEditing(_ textView: UITextView) {
            parent.isFocused = true
        }

        func textViewDidEndEditing(_ textView: UITextView) {
            parent.isFocused = false
        }
    }
}
