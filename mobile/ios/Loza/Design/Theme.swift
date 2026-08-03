//
//  Theme.swift
//  Loza
//
//  Bright, vivid design system with original palette and rich glass effects.
//

import SwiftUI

// MARK: - Color System

enum LozaColor {
    // Original dark background
    static let bgMobile = Color(hex: 0x1A1A24)

    // Text hierarchy
    static let textPrimary   = Color.white.opacity(0.92)
    static let textSecondary = Color.white.opacity(0.55)
    static let textTertiary  = Color.white.opacity(0.30)
    static let textFaint     = Color.white.opacity(0.22)

    // Original vibrant accents
    static let accentPink    = Color(hex: 0xFFB6D2)
    static let accentPurple  = Color(hex: 0xB478FF)
    static let accentBlue    = Color(hex: 0x5FB8FF)
    static let accentGreen   = Color(hex: 0x3ECF6E)
    static let accentYellow  = Color(hex: 0xFFBD2E)
    static let accentRed     = Color(hex: 0xFF6464)

    // Semantic
    static let error   = accentRed
    static let success = accentGreen

    // Glass surfaces — more saturated
    static let glassStroke     = Color.white.opacity(0.10)
    static let glassFill       = Color.white.opacity(0.05)
    static let glassFillStrong = Color.white.opacity(0.10)

    // Separators
    static let separator = Color.white.opacity(0.05)

    // Gradients — vivid
    static let accentGradient = LinearGradient(
        colors: [accentPink, accentPurple],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    static let warmGradient = LinearGradient(
        colors: [accentPink.opacity(0.8), accentPurple.opacity(0.6)],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    static let coolGradient = LinearGradient(
        colors: [accentBlue.opacity(0.6), accentPurple.opacity(0.5)],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    static let pinkGlow = LinearGradient(
        colors: [accentPink.opacity(0.3), accentPink.opacity(0.1)],
        startPoint: .top,
        endPoint: .bottom
    )

    static let purpleGlow = LinearGradient(
        colors: [accentPurple.opacity(0.3), accentPurple.opacity(0.1)],
        startPoint: .top,
        endPoint: .bottom
    )

    enum GlassStyle {
        case regular
    }
}

// MARK: - Typography (slightly larger)

enum LozaType {
    static let largeTitle: Font = .system(size: 28, weight: .light)
    static let title: Font = .system(size: 16, weight: .medium)
    static let headline: Font = .system(size: 15, weight: .medium)
    static let subheadline: Font = .system(size: 13, weight: .medium)
    static let body: Font = .system(size: 15)
    static let callout: Font = .system(size: 14)
    static let footnote: Font = .system(size: 12)
    static let caption: Font = .system(size: 11)
    static let micro: Font = .system(size: 10)
    static let statNumber: Font = .system(size: 28, weight: .light)
    static let statLabel: Font = .system(size: 12)
    static let cardTitle: Font = .system(size: 11, weight: .semibold)
    static let buttonLabel: Font = .system(size: 15, weight: .medium)
    static let fieldLabel: Font = .system(size: 10, weight: .regular)
    static let fieldInput: Font = .system(size: 15)
}

// MARK: - Spacing

enum LozaSpacing {
    static let xxs: CGFloat = 2
    static let xs: CGFloat = 4
    static let sm: CGFloat = 6
    static let md: CGFloat = 8
    static let lg: CGFloat = 12
    static let xl: CGFloat = 16
    static let xxl: CGFloat = 20
    static let xxxl: CGFloat = 24
    static let section: CGFloat = 28
    static let screen: CGFloat = 16
}

// MARK: - Corner Radii

enum LozaMetrics {
    static let cardRadius: CGFloat = 16
    static let fieldRadius: CGFloat = 13
    static let sheetRadius: CGFloat = 26
    static let pillRadius: CGFloat = 999
    static let smallRadius: CGFloat = 8
    static let mediumRadius: CGFloat = 10
    static let largeRadius: CGFloat = 14
}

// MARK: - Color Helpers

extension Color {
    init(hex: UInt32, alpha: Double = 1.0) {
        let r = Double((hex >> 16) & 0xFF) / 255.0
        let g = Double((hex >> 8) & 0xFF) / 255.0
        let b = Double(hex & 0xFF) / 255.0
        self.init(.sRGB, red: r, green: g, blue: b, opacity: alpha)
    }

    init(hexString: String) {
        var s = hexString
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let value = UInt32(s, radix: 16) else {
            self = Color.gray
            return
        }
        self.init(hex: value)
    }
}

// MARK: - Glass Materials

@available(iOS 26.0, *)
private func glassMaterial(_ style: LozaColor.GlassStyle) -> Glass {
    switch style {
    case .regular: return .regular
    }
}

// MARK: - View Modifiers

struct LozaCardBackground: ViewModifier {
    var radius: CGFloat = LozaMetrics.cardRadius
    var glassStyle: LozaColor.GlassStyle = .regular

    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content
                .glassEffect(glassMaterial(glassStyle), in: RoundedRectangle(cornerRadius: radius, style: .continuous))
        } else {
            content
                .background(
                    RoundedRectangle(cornerRadius: radius, style: .continuous)
                        .fill(LozaColor.glassFill)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: radius, style: .continuous)
                        .stroke(LozaColor.glassStroke, lineWidth: 1)
                )
                .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
        }
    }
}

extension View {
    func lozaCard(radius: CGFloat = LozaMetrics.cardRadius,
                  glassStyle: LozaColor.GlassStyle = .regular) -> some View {
        modifier(LozaCardBackground(radius: radius, glassStyle: glassStyle))
    }

    @ViewBuilder
    func lozaGlass(radius: CGFloat = LozaMetrics.cardRadius,
                   style: LozaColor.GlassStyle = .regular) -> some View {
        if #available(iOS 26.0, *) {
            self
                .glassEffect(glassMaterial(style), in: RoundedRectangle(cornerRadius: radius, style: .continuous))
                .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
        } else {
            self
                .background(
                    RoundedRectangle(cornerRadius: radius, style: .continuous)
                        .fill(LozaColor.glassFill)
                )
                .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
        }
    }

    @ViewBuilder
    func lozaMiniGlass(radius: CGFloat, fallbackOpacity: Double = 0.05) -> some View {
        if #available(iOS 26.0, *) {
            self
                .glassEffect(.regular, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
        } else {
            self
                .background(
                    RoundedRectangle(cornerRadius: radius, style: .continuous)
                        .fill(Color.white.opacity(fallbackOpacity))
                )
        }
    }

    @ViewBuilder
    func lozaBackground() -> some View {
        self
            .background { LozaBackgroundView() }
    }

    @ViewBuilder
    func lozaListRowBackground() -> some View {
        if #available(iOS 26.0, *) {
            Color.clear
        } else {
            Color.white.opacity(0.04)
        }
    }
}

// MARK: - Reusable Components

struct CardLabel: View {
    let text: String
    var body: some View {
        Text(text.uppercased())
            .font(LozaType.cardTitle)
            .tracking(0.8)
            .foregroundStyle(LozaColor.textTertiary)
    }
}

// MARK: - Full-Screen Background

struct LozaBackgroundView: View {
    var body: some View {
        LozaColor.bgMobile
            .ignoresSafeArea()
    }
}
