import SwiftUI

struct GlassModifier: ViewModifier {
    var radius: CGFloat = Radius.lg
    var opacity: Double = 0.08

    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content
                .glassEffect(.regular.tint(AlchemyColors.card.opacity(0.3)), in: .rect(cornerRadius: radius))
        } else {
            content
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: radius))
                .overlay(
                    RoundedRectangle(cornerRadius: radius)
                        .stroke(Color.white.opacity(opacity), lineWidth: 0.5)
                )
        }
    }
}

struct GlassCapsuleModifier: ViewModifier {
    var opacity: Double = 0.08

    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content
                .glassEffect(.regular.tint(AlchemyColors.card.opacity(0.3)), in: .capsule)
        } else {
            content
                .background(.ultraThinMaterial, in: Capsule())
                .overlay(
                    Capsule()
                        .stroke(Color.white.opacity(opacity), lineWidth: 0.5)
                )
        }
    }
}

extension View {
    func alchemyGlass(radius: CGFloat = Radius.lg) -> some View {
        modifier(GlassModifier(radius: radius))
    }

    func alchemyGlassCapsule() -> some View {
        modifier(GlassCapsuleModifier())
    }
}

enum ChatGlassSurfaceRole {
    case panel
    case composer
    case assistantBubble
    case userBubble
    case chip
    case shell

    var baseOpacity: Double {
        switch self {
        case .panel: return 0.18
        case .composer: return 0.11
        case .assistantBubble: return 0.14
        case .userBubble: return 0.07
        case .chip: return 0.13
        case .shell: return 0.14
        }
    }

    var animatedSheen: Bool {
        self == .panel || self == .composer
    }
}

struct ChatGlassPalette {
    // Flatter frosted palette that keeps underlying mesh visible.
    static let panelBaseA = Color(hex: 0x233B58).opacity(0.2)
    static let panelBaseB = Color(hex: 0x2C2A4A).opacity(0.17)
    static let panelBaseC = Color(hex: 0x101A2D).opacity(0.21)

    static let frostWhite = Color.white.opacity(0.14)
    static let coolInfusion = Color(hex: 0x63C8FF).opacity(0.14)
    static let warmInfusion = Color(hex: 0x8E3D6D).opacity(0.11)

    static let strokeSoft = Color.white.opacity(0.17)
    static let strokeStrong = Color.white.opacity(0.25)
}

private struct ChatLiquidSurfaceModifier: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @State private var animationSeed: Double = .random(in: 0...10_000)

    let role: ChatGlassSurfaceRole
    let focused: Bool
    let cornerRadius: CGFloat

    func body(content: Content) -> some View {
        content
            .background(backgroundView)
            .onAppear {
                animationSeed = .random(in: 0...10_000)
            }
    }

    @ViewBuilder
    private var backgroundView: some View {
        fallbackBackground
    }

    private var fallbackBackground: some View {
        let extraOpacity = reduceTransparency ? 0.12 : 0
        let isAnimated = role.animatedSheen && !reduceMotion
        let isAssistantBubble = role == .assistantBubble
        let isUserBubble = role == .userBubble
        let isBubble = isAssistantBubble || isUserBubble
        let isComposer = role == .composer
        let materialOpacity = isUserBubble ? 0.72 : (isAssistantBubble ? 0.94 : (isComposer ? 0.9 : 0.8))
        let darkFillOpacity = isUserBubble ? 0.01 : (isAssistantBubble ? 0.04 : (isComposer ? 0.015 : 0.1))
        let driftOpacity = isUserBubble ? 0.065 : (isAssistantBubble ? 0.16 : (isComposer ? 0.07 : 0.24))
        let coolBloomOpacity = isUserBubble ? 0.055 : (isAssistantBubble ? 0.11 : (isComposer ? 0.045 : 0.17))
        let warmBloomOpacity = isUserBubble ? 0.02 : (isAssistantBubble ? 0.05 : (isComposer ? 0.02 : 0.11))
        let tintBloomOpacity = isUserBubble ? 0.05 : (isAssistantBubble ? 0.12 : (isComposer ? 0.055 : 0.2))
        let strokeWidth = isUserBubble ? 0.5 : (isAssistantBubble ? 0.62 : (isComposer ? (focused ? 0.66 : 0.56) : (focused ? 0.86 : 0.74)))
        let glowOpacity = isUserBubble ? 0.045 : (isAssistantBubble ? 0.08 : (isComposer ? 0.055 : 0.16))
        let shadowOpacity = isUserBubble ? 0.015 : (isAssistantBubble ? 0.03 : (isComposer ? 0.018 : 0.06))

        return TimelineView(.periodic(from: .now, by: isAnimated ? (1.0 / 20.0) : 60.0)) { timeline in
            let time = timeline.date.timeIntervalSinceReferenceDate + animationSeed
            let phase = CGFloat(sin(time * 0.09))
            let colorDrift = CGFloat(sin(time * 0.035))
            let shimmerOpacity = isAnimated
                ? (isUserBubble ? 0.012 : (isAssistantBubble ? 0.02 : (isComposer ? 0.018 : 0.045)))
                : (isUserBubble ? 0.004 : (isAssistantBubble ? 0.006 : (isComposer ? 0.008 : 0.016)))
            let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            let deepBlue = Color(
                hue: 0.58 + (0.014 * Double(colorDrift)),
                saturation: isUserBubble ? 0.48 : (isComposer ? 0.56 : 0.68),
                brightness: isUserBubble ? 0.54 : (isComposer ? 0.52 : 0.44),
                opacity: isUserBubble ? 0.02 : (isComposer ? (0.038 + (focused ? 0.008 : 0)) : (0.08 + (focused ? 0.015 : 0)))
            )
            let deepMagenta = Color(
                hue: 0.89 + (0.022 * Double(sin(time * 0.051 + 1.2))),
                saturation: isUserBubble ? 0.34 : (isComposer ? 0.4 : 0.56),
                brightness: isUserBubble ? 0.46 : (isComposer ? 0.44 : 0.38),
                opacity: isUserBubble ? 0.016 : (isComposer ? 0.028 : 0.06)
            )
            let deepShadow = Color(hex: 0x0B1424).opacity(isUserBubble ? 0.04 : (isComposer ? 0.045 : 0.1))

            ZStack {
                shape
                    .fill(.ultraThinMaterial)
                    .opacity(materialOpacity)

                shape
                    .fill(Color(hex: 0x09101E).opacity(darkFillOpacity))

                // Soft top highlight like iOS liquid glass.
                shape
                    .fill(
                        LinearGradient(
                            colors: [
                                Color.white.opacity(isUserBubble ? 0.05 : (isAssistantBubble ? 0.1 : (isComposer ? 0.08 : 0.1))),
                                Color.white.opacity(isUserBubble ? 0.02 : (isAssistantBubble ? 0.03 : (isComposer ? 0.014 : 0.03))),
                                .clear
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )

                // Very subtle dark-color drift to make the surface feel alive.
                shape
                    .fill(
                        LinearGradient(
                            colors: [deepBlue, deepMagenta, deepShadow],
                            startPoint: UnitPoint(x: 0.18 + (0.04 * phase), y: 0.12),
                            endPoint: UnitPoint(x: 0.88 - (0.03 * phase), y: 0.9)
                        )
                    )
                    .opacity(driftOpacity)

                shape
                    .fill(
                        RadialGradient(
                            colors: [
                                Color(hex: 0xAAB7FF).opacity(0.08),
                                .clear
                            ],
                            center: UnitPoint(x: 0.22 + (0.07 * phase), y: 0.24),
                            startRadius: 10,
                            endRadius: 220
                        )
                    )
                    .blendMode(.plusLighter)
                    .opacity(coolBloomOpacity)
                shape
                    .fill(
                        RadialGradient(
                            colors: [
                                ChatGlassPalette.warmInfusion.opacity(0.14),
                                .clear
                            ],
                            center: UnitPoint(x: 0.86 - (0.08 * phase), y: 0.84),
                            startRadius: 10,
                            endRadius: 220
                        )
                    )
                    .blendMode(.plusLighter)
                    .opacity(warmBloomOpacity)

                // Frosted depth tint.
                shape
                    .fill(
                        LinearGradient(
                            colors: [
                                ChatGlassPalette.panelBaseA.opacity(role.baseOpacity + extraOpacity + (isBubble ? 0.0 : 0.03)),
                                ChatGlassPalette.panelBaseB.opacity(role.baseOpacity + extraOpacity + (isBubble ? 0.0 : 0.02)),
                                ChatGlassPalette.panelBaseC.opacity(role.baseOpacity + extraOpacity + (isUserBubble ? 0.0 : (isAssistantBubble ? 0.01 : 0.04)))
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )

                // Internal cool bloom to keep the "AI" feel.
                shape
                    .fill(
                        RadialGradient(
                            colors: [ChatGlassPalette.coolInfusion.opacity(isUserBubble ? (focused ? 0.08 : 0.045) : (focused ? 0.18 : 0.1)), .clear],
                            center: .init(x: 0.2 + (0.05 * phase), y: 0.35),
                            startRadius: 8,
                            endRadius: 280
                        )
                    )
                    .blendMode(.screen)
                    .opacity(tintBloomOpacity)

                // Moving liquid sweep.
                shape
                    .fill(
                        LinearGradient(
                            colors: [
                                .clear,
                                ChatGlassPalette.frostWhite.opacity(shimmerOpacity),
                                .clear
                            ],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .scaleEffect(x: 1.85, y: 1)
                    .offset(x: 72 * phase)
                    .blur(radius: 10)
                    .opacity(shimmerOpacity)
                    .mask(shape)

                shape
                    .stroke(focused ? ChatGlassPalette.strokeStrong : ChatGlassPalette.strokeSoft, lineWidth: strokeWidth)
                shape
                    .stroke(Color.white.opacity(0.06), lineWidth: 1.4)
                    .blur(radius: 5)
                    .opacity(glowOpacity)
            }
            .shadow(color: .black.opacity(shadowOpacity), radius: isUserBubble ? 2 : (isBubble ? 4 : 7), x: 0, y: isUserBubble ? 0.5 : (isBubble ? 1 : 2))
        }
    }
}

private struct ChatLiquidPanelBackgroundModifier<S: Shape>: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @State private var animationSeed: Float = .random(in: 0...10_000)

    let shape: S

    func body(content: Content) -> some View {
        content
            .background(backgroundView)
            .onAppear {
                animationSeed = .random(in: 0...10_000)
            }
    }

    @ViewBuilder
    private var backgroundView: some View {
        let extraOpacity = reduceTransparency ? 0.12 : 0
        let animate = !reduceMotion

        TimelineView(.periodic(from: .now, by: animate ? (1.0 / 24.0) : 60.0)) { timeline in
            let time = timeline.date.timeIntervalSinceReferenceDate
            let cycle: Float = 20.0
            let normalizedTime = (Float(time) + animationSeed) / cycle
            let keyframe = floor(normalizedTime)
            let nextKeyframe = keyframe + 1
            let blend = smoothstep(normalizedTime - keyframe)

            let meshOffsetX0 = randomRange(seed: keyframe * 19 + animationSeed + 1, min: -0.06, max: 0.06)
            let meshOffsetY0 = randomRange(seed: keyframe * 19 + animationSeed + 2, min: -0.05, max: 0.05)
            let meshOffsetX1 = randomRange(seed: nextKeyframe * 19 + animationSeed + 1, min: -0.06, max: 0.06)
            let meshOffsetY1 = randomRange(seed: nextKeyframe * 19 + animationSeed + 2, min: -0.05, max: 0.05)
            let meshOffsetX = lerp(meshOffsetX0, meshOffsetX1, blend)
            let meshOffsetY = lerp(meshOffsetY0, meshOffsetY1, blend)

            let coolStrength = lerp(
                randomRange(seed: keyframe * 19 + animationSeed + 3, min: 0.9, max: 1.08),
                randomRange(seed: nextKeyframe * 19 + animationSeed + 3, min: 0.9, max: 1.08),
                blend
            )
            let warmStrength = lerp(
                randomRange(seed: keyframe * 19 + animationSeed + 4, min: 0.88, max: 1.1),
                randomRange(seed: nextKeyframe * 19 + animationSeed + 4, min: 0.88, max: 1.1),
                blend
            )
            let bloomDriftX = CGFloat(lerp(
                randomRange(seed: keyframe * 19 + animationSeed + 5, min: -0.055, max: 0.055),
                randomRange(seed: nextKeyframe * 19 + animationSeed + 5, min: -0.055, max: 0.055),
                blend
            ))
            let bloomDriftY = CGFloat(lerp(
                randomRange(seed: keyframe * 19 + animationSeed + 6, min: -0.05, max: 0.05),
                randomRange(seed: nextKeyframe * 19 + animationSeed + 6, min: -0.05, max: 0.05),
                blend
            ))
            let hueRotation = Double(lerp(
                randomRange(seed: keyframe * 19 + animationSeed + 7, min: -4.5, max: 4.5),
                randomRange(seed: nextKeyframe * 19 + animationSeed + 7, min: -4.5, max: 4.5),
                blend
            ))
            let saturation = CGFloat(lerp(
                randomRange(seed: keyframe * 19 + animationSeed + 8, min: 0.98, max: 1.04),
                randomRange(seed: nextKeyframe * 19 + animationSeed + 8, min: 0.98, max: 1.04),
                blend
            ))

            ZStack {
                shape
                    .fill(.ultraThinMaterial)
                    .opacity(0.48)

                shape
                    .fill(Color(hex: 0x080F1C).opacity(0.1))

                shape.fill(
                    MeshGradient(
                        width: 4,
                        height: 4,
                        points: [
                            [0.0, 0.0], [0.32, 0.0], [0.7, 0.0], [1.0, 0.0],
                            [0.0, 0.34], [0.24 + meshOffsetX, 0.33 - meshOffsetY], [0.73 - (meshOffsetX * 0.78), 0.28 + meshOffsetY], [1.0, 0.34],
                            [0.0, 0.72], [0.3 - (meshOffsetX * 0.68), 0.78 + (meshOffsetY * 0.62)], [0.72 + meshOffsetX, 0.66 - (meshOffsetY * 0.72)], [1.0, 0.72],
                            [0.0, 1.0], [0.35, 1.0], [0.72, 1.0], [1.0, 1.0]
                        ],
                        colors: [
                            Color(hex: 0x041126), Color(hex: 0x0A2D4D), Color(hex: 0x143F6B), Color(hex: 0x06152B),
                            Color(hex: 0x120A1F), Color(hex: 0x0D3760), Color(hex: 0x5B1E46), Color(hex: 0x0B1D39),
                            Color(hex: 0x150A22), Color(hex: 0x2A1438), Color(hex: 0x0F3A68), Color(hex: 0x08162D),
                            Color(hex: 0x060F1F), Color(hex: 0x101B2E), Color(hex: 0x20102C), Color(hex: 0x060E1C)
                        ],
                        background: Color(hex: 0x060E1A)
                    )
                )
                .hueRotation(.degrees(hueRotation))
                .saturation(saturation)
                .opacity(0.34)

                shape
                    .fill(
                        LinearGradient(
                            stops: [
                                .init(color: Color.white.opacity(0.058), location: 0),
                                .init(color: Color.white.opacity(0.012), location: 0.24),
                                .init(color: .clear, location: 0.62)
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )

                shape
                    .fill(
                        RadialGradient(
                            colors: [
                                Color(hex: 0x66C8FF).opacity(0.12 * Double(coolStrength)),
                                .clear
                            ],
                            center: UnitPoint(x: 0.18 + (0.12 * bloomDriftX), y: 0.24 + (0.08 * bloomDriftY)),
                            startRadius: 10,
                            endRadius: 320
                        )
                    )
                    .blendMode(.plusLighter)
                    .opacity(0.08)
                shape
                    .fill(
                        RadialGradient(
                            colors: [
                                ChatGlassPalette.warmInfusion.opacity(0.11 * Double(warmStrength)),
                                .clear
                            ],
                            center: UnitPoint(x: 0.84 - (0.12 * bloomDriftX), y: 0.86 - (0.09 * bloomDriftY)),
                            startRadius: 10,
                            endRadius: 360
                        )
                    )
                    .blendMode(.plusLighter)
                    .opacity(0.06)

                shape.fill(
                    LinearGradient(
                        stops: [
                            .init(color: ChatGlassPalette.panelBaseA.opacity(0.12 + extraOpacity), location: 0),
                            .init(color: ChatGlassPalette.panelBaseB.opacity(0.1 + extraOpacity), location: 0.54),
                            .init(color: ChatGlassPalette.panelBaseC.opacity(0.14 + extraOpacity), location: 1)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )

                shape
                    .fill(
                        RadialGradient(
                            colors: [ChatGlassPalette.coolInfusion.opacity(0.06), .clear],
                            center: UnitPoint(x: 0.24 + (0.06 * bloomDriftX), y: 0.44 + (0.04 * bloomDriftY)),
                            startRadius: 8,
                            endRadius: 420
                        )
                    )
                    .blendMode(.screen)
                    .opacity(0.16)

                shape
                    .fill(
                        LinearGradient(
                            colors: [
                                Color.black.opacity(0.06),
                                Color.black.opacity(0.012),
                                Color.black.opacity(0.078)
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )

                shape
                    .fill(
                        LinearGradient(
                            colors: [.clear, ChatGlassPalette.frostWhite.opacity(0.14), .clear],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .scaleEffect(x: 1.9, y: 1)
                    .offset(x: 102 * CGFloat(blend * 2 - 1))
                    .blur(radius: 16)
                    .opacity(animate ? 0.042 : 0.02)
                    .mask(shape)

                shape.stroke(ChatGlassPalette.strokeSoft.opacity(0.72), lineWidth: 0.72)
                shape
                    .stroke(Color.white.opacity(0.06), lineWidth: 1.3)
                    .blur(radius: 6)
                    .opacity(0.16)
            }
            .shadow(color: .black.opacity(0.06), radius: 8, x: 0, y: 4)
        }
    }

    private func hash(_ value: Float) -> Float {
        let x = sin(value * 12.9898 + 78.233) * 43758.5453
        return x - floor(x)
    }

    private func randomRange(seed: Float, min: Float, max: Float) -> Float {
        min + (max - min) * hash(seed)
    }

    private func lerp(_ a: Float, _ b: Float, _ t: Float) -> Float {
        a + (b - a) * t
    }

    private func smoothstep(_ t: Float) -> Float {
        let clamped = max(0, min(1, t))
        return clamped * clamped * (3 - 2 * clamped)
    }
}

extension View {
    func chatLiquidSurface(role: ChatGlassSurfaceRole, focused: Bool, cornerRadius: CGFloat) -> some View {
        modifier(ChatLiquidSurfaceModifier(role: role, focused: focused, cornerRadius: cornerRadius))
    }

    func chatLiquidPanelBackground<S: Shape>(_ shape: S) -> some View {
        modifier(ChatLiquidPanelBackgroundModifier(shape: shape))
    }
}
