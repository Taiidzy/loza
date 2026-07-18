//
//  DashboardPieces.swift
//  Loza
//
//  Small shared pieces used across MainView's dashboard: the generic
//  "Card" shell, its uppercase label, a loading skeleton, and the
//  mini sparkline — ports of the matching helpers in MainPage.tsx.
//

import SwiftUI

struct DashboardCard<Content: View>: View {
    var delay: Double = 0
    @ViewBuilder var content: Content

    @State private var appeared = false

    var body: some View {
        content
            .padding(.horizontal, 18)
            .padding(.vertical, 16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .lozaCard()
            .opacity(appeared ? 1 : 0)
            .offset(y: appeared ? 0 : 12)
            .onAppear {
                withAnimation(.easeOut(duration: 0.4).delay(delay)) {
                    appeared = true
                }
            }
    }
}

struct CardLabel: View {
    let text: String
    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 10))
            .tracking(0.8)
            .foregroundStyle(LozaColor.textTertiary)
    }
}

struct CardSkeleton: View {
    var delay: Double = 0
    @State private var appeared = false

    var body: some View {
        RoundedRectangle(cornerRadius: LozaMetrics.cardRadius, style: .continuous)
            .fill(Color.white.opacity(0.03))
            .overlay(
                RoundedRectangle(cornerRadius: LozaMetrics.cardRadius, style: .continuous)
                    .stroke(Color.white.opacity(0.06), lineWidth: 1)
            )
            .frame(height: 148)
            .opacity(appeared ? 1 : 0)
            .offset(y: appeared ? 0 : 12)
            .onAppear {
                withAnimation(.easeOut(duration: 0.4).delay(delay)) {
                    appeared = true
                }
            }
    }
}

struct Sparkline: View {
    let values: [Double]
    let color: Color

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let h = geo.size.height
            let maxV = values.max() ?? 1
            let minV = values.min() ?? 0
            let range = max(maxV - minV, 1)

            let points: [CGPoint] = values.enumerated().map { i, v in
                let x = values.count > 1 ? (CGFloat(i) / CGFloat(values.count - 1)) * w : 0
                let y = h - CGFloat((v - minV) / range) * h
                return CGPoint(x: x, y: y)
            }

            ZStack {
                Path { path in
                    guard let first = points.first else { return }
                    path.move(to: first)
                    for p in points.dropFirst() { path.addLine(to: p) }
                }
                .stroke(color.opacity(0.7), style: StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))

                if let last = points.last {
                    Circle()
                        .fill(color)
                        .frame(width: 5, height: 5)
                        .position(last)
                }
            }
        }
        .frame(width: 80, height: 28)
    }
}
