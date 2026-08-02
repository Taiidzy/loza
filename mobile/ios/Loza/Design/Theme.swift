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

    enum GlassStyle {
        case regular
    }
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

    /// Parses a "#rrggbb" string as sent by the backend (StorageCategory.color,
    /// CalendarEvent.color). Falls back to a neutral gray on malformed input
    /// rather than crashing — server data shouldn't be able to take the UI down.
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

// Small helper so cards look identical to the web "Card" component:
// on iOS 26 this is true Liquid Glass; on older versions a translucent
// fill + hairline stroke + 16pt radius.
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
                        .fill(LozaColor.cardFill)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: radius, style: .continuous)
                        .stroke(LozaColor.cardStroke, lineWidth: 1)
                )
                .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
        }
    }
}

// The `glassMaterial` helper returns a Glass for iOS 26+.
@available(iOS 26.0, *)
private func glassMaterial(_ style: LozaColor.GlassStyle) -> Glass {
    switch style {
    case .regular: return .regular
    }
}

extension View {
    func lozaCard(radius: CGFloat = LozaMetrics.cardRadius,
                  glassStyle: LozaColor.GlassStyle = .regular) -> some View {
        modifier(LozaCardBackground(radius: radius, glassStyle: glassStyle))
    }

    /// Applies a Liquid Glass background to any view (iOS 26+) with a
    /// translucent-fallback for older versions.
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
                        .fill(LozaColor.cardFill)
                )
                .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
        }
    }
}

// ─── Full-screen background ─────────────────────────────────────────────────────

/// Standalone background view that can be used as a ZStack child.
struct LozaBackgroundView: View {
    var body: some View {
        LozaColor.bgMobile
            .ignoresSafeArea()
    }
}

extension View {
    /// Adds a full-screen background: on iOS 26+ this resolves to the system
    /// Liquid Glass background (dark in dark-mode); on older versions it
    /// falls back to LozaColor.bgMobile.
    @ViewBuilder
    func lozaBackground() -> some View {
        self
            .background { LozaBackgroundView() }
    }
}

// ─── Small tile background (icon backgrounds, picker cells) ───────────────────────

extension View {
    /// For small rounded-rectangle backgrounds that on iOS < 26 used
    /// `.fill(Color.white.opacity(0.0X))` + a stroke. On iOS 26+ these
    /// become true mini glass tiles.
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
}

// ─── List row background ──────────────────────────────────────────────────────────

extension View {
    /// On iOS 26+, List rows get the system Liquid Glass background for free,
    /// so we pass `.clear` to let it show through. On older versions we keep
    /// the classic translucent card fill.
    @ViewBuilder
    func lozaListRowBackground() -> some View {
        if #available(iOS 26.0, *) {
            Color.clear
        } else {
            Color.white.opacity(0.04)
        }
    }
}
