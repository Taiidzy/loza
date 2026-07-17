//
//  Theme.swift
//  Loza
//
//  Design tokens mirrored from the web app's App.css / inline styles.
//  Keeping the same palette, radii, and type scale so the native app
//  reads as "the same app", just running on Liquid Glass.
//

import SwiftUI

enum LozaColor {
    // Base surfaces
    static let bgMobile = Color(hex: 0x1A1A24)

    // Text
    static let textPrimary   = Color.white.opacity(0.92)
    static let textSecondary = Color.white.opacity(0.55)
    static let textTertiary  = Color.white.opacity(0.30)
    static let textFaint     = Color.white.opacity(0.22)

    // Accent (pink / purple gradient used across the app)
    static let accentPink   = Color(hex: 0xFFB6D2)   // rgba(255,182,210,*)
    static let accentPurple = Color(hex: 0xB478FF)   // rgba(180,120,255,*)
    static let accentBlue   = Color(hex: 0x5FB8FF)
    static let accentGreen  = Color(hex: 0x3ECF6E)
    static let accentYellow = Color(hex: 0xFFBD2E)
    static let accentRed    = Color(hex: 0xFF6464)

    static let cardStroke = Color.white.opacity(0.08)
    static let cardFill   = Color.white.opacity(0.04)

    static let accentGradient = LinearGradient(
        colors: [accentPink, accentPurple],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )
}

enum LozaMetrics {
    static let cardRadius: CGFloat = 16
    static let fieldRadius: CGFloat = 13
    static let sheetRadius: CGFloat = 26
    static let pillRadius: CGFloat = 999
}

extension Color {
    init(hex: UInt32, alpha: Double = 1.0) {
        let r = Double((hex >> 16) & 0xFF) / 255.0
        let g = Double((hex >> 8) & 0xFF) / 255.0
        let b = Double(hex & 0xFF) / 255.0
        self.init(.sRGB, red: r, green: g, blue: b, opacity: alpha)
    }
}

// Small helper so cards look identical to the web "Card" component:
// translucent fill + hairline stroke + 16pt radius.
struct LozaCardBackground: ViewModifier {
    var radius: CGFloat = LozaMetrics.cardRadius
    func body(content: Content) -> some View {
        content
            .background(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .fill(LozaColor.cardFill)
            )
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .stroke(LozaColor.cardStroke, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
    }
}

extension View {
    func lozaCard(radius: CGFloat = LozaMetrics.cardRadius) -> some View {
        modifier(LozaCardBackground(radius: radius))
    }
}
