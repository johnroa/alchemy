import SwiftUI

/// Animated light holographic mesh gradient for the AI chat interface.
///
/// Uses SwiftUI's native `MeshGradient` with `TimelineView` to continuously
/// animate control points. The palette is soft pastels — pinks, lavenders,
/// pale mints, icy blues — creating an ethereal, iridescent "AI" feel.
///
/// Chat bubbles and input elements are styled dark to contrast against this
/// bright, shifting backdrop. The center control point orbits with enough
/// amplitude (0.18) to make the color shifts clearly visible.
///
/// Corner points are pinned at exact boundaries so the gradient always fills
/// edge-to-edge without pulling inward.
struct AnimatedMeshBackground: View {
    var opacity: Double = 0.95

    var body: some View {
        TimelineView(.animation) { timeline in
            let t = timeline.date.timeIntervalSince1970

            MeshGradient(
                width: 3,
                height: 3,
                points: [
                    // Corners pinned — prevents gradient from pulling away from edges
                    simd(0.0, 0.0),
                    simd(0.5, 0.0),
                    simd(1.0, 0.0),

                    // Middle row — edge points stay on their edge, center orbits freely
                    simd(0.0, Float(0.5 + 0.1 * sin(t * 0.4))),
                    simd(
                        Float(0.5 + 0.18 * cos(t * 0.7)),
                        Float(0.5 + 0.18 * sin(t * 0.55))
                    ),
                    simd(1.0, Float(0.5 + 0.1 * cos(t * 0.5))),

                    // Bottom corners pinned
                    simd(0.0, 1.0),
                    simd(0.5, 1.0),
                    simd(1.0, 1.0),
                ],
                colors: [
                    // Light holographic palette — soft pastels that shift and blend.
                    // Inspired by iridescent/pearlescent surfaces.
                    Color(red: 0.88, green: 0.85, blue: 0.95),   // soft lavender
                    Color(red: 0.82, green: 0.92, blue: 0.96),   // icy blue
                    Color(red: 0.90, green: 0.88, blue: 0.96),   // pale lilac

                    Color(red: 0.85, green: 0.94, blue: 0.90),   // mint
                    Color(red: 0.95, green: 0.86, blue: 0.90),   // blush pink — center warmth
                    Color(red: 0.84, green: 0.90, blue: 0.97),   // powder blue

                    Color(red: 0.92, green: 0.88, blue: 0.94),   // light mauve
                    Color(red: 0.86, green: 0.95, blue: 0.94),   // pale aqua
                    Color(red: 0.90, green: 0.86, blue: 0.93),   // soft violet
                ],
                smoothsColors: true
            )
        }
        .opacity(opacity)
    }

    private func simd(_ x: Float, _ y: Float) -> SIMD2<Float> {
        SIMD2<Float>(x, y)
    }
}
