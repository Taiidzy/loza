//
//  StatCards.swift
//  Loza
//
//  Vivid stat cards with gradient backgrounds and alive sparklines.
//

import SwiftUI

// MARK: - Metric Card (vivid)

private struct MetricCard: View {
    let icon: String
    let iconColor: Color
    let value: String
    let label: String
    let sparklinePoints: [Double]?
    let sparklineColor: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 11))
                    .foregroundStyle(iconColor)
                    .frame(width: 16)
                Text(label)
                    .font(LozaType.fieldLabel)
                    .foregroundStyle(.white.opacity(0.38))
                    .lineLimit(1)
            }

            HStack(alignment: .bottom, spacing: 6) {
                Text(value)
                    .font(LozaType.statNumber)
                    .foregroundStyle(.white.opacity(0.92))
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)

                if let points = sparklinePoints {
                    Sparkline(points: points, color: sparklineColor)
                        .frame(width: 32, height: 16)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(iconColor.opacity(0.08))
        )
    }
}

// MARK: - Concrete Cards (vivid)

struct ClientsCard: View {
    let value: String
    @State private var points: [Double] = []
    @State private var timer: Timer?

    var body: some View {
        MetricCard(
            icon: "person.2.fill",
            iconColor: LozaColor.accentPink,
            value: value,
            label: "Клиенты",
            sparklinePoints: points.isEmpty ? nil : points,
            sparklineColor: LozaColor.accentPink
        )
        .onAppear { startTick() }
        .onDisappear { stopTick() }
    }

    private func startTick() {
        timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { _ in
            appendPoint()
        }
        appendPoint()
    }

    private func stopTick() {
        timer?.invalidate()
        timer = nil
    }

    private func appendPoint() {
        points.append(animateDouble())
        if points.count > 30 { points.removeFirst() }
    }

    private func animateDouble() -> Double {
        guard let first = points.last else { return 0 }
        var next = first + Double.random(in: -1.5...1.5)
        next = max(-6, min(6, next))
        return next
    }
}

struct StorageCard: View {
    let value: String
    @State private var points: [Double] = []
    @State private var timer: Timer?

    var body: some View {
        MetricCard(
            icon: "internaldrive.fill",
            iconColor: LozaColor.accentPurple,
            value: value,
            label: "Память",
            sparklinePoints: points.isEmpty ? nil : points,
            sparklineColor: LozaColor.accentPurple
        )
        .onAppear { startTick() }
        .onDisappear { stopTick() }
    }

    private func startTick() {
        timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { _ in
            appendPoint()
        }
        appendPoint()
    }

    private func stopTick() {
        timer?.invalidate()
        timer = nil
    }

    private func appendPoint() {
        points.append(animateDouble())
        if points.count > 30 { points.removeFirst() }
    }

    private func animateDouble() -> Double {
        guard let first = points.last else { return 0 }
        var next = first + Double.random(in: -0.8...0.8)
        next = max(-4, min(4, next))
        return next
    }
}

struct LoadCard: View {
    let value: String
    @State private var points: [Double] = []
    @State private var timer: Timer?

    var body: some View {
        MetricCard(
            icon: "network",
            iconColor: LozaColor.accentBlue,
            value: value,
            label: "Нагрузка",
            sparklinePoints: points.isEmpty ? nil : points,
            sparklineColor: LozaColor.accentBlue
        )
        .onAppear { startTick() }
        .onDisappear { stopTick() }
    }

    private func startTick() {
        timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { _ in
            appendPoint()
        }
        appendPoint()
    }

    private func stopTick() {
        timer?.invalidate()
        timer = nil
    }

    private func appendPoint() {
        points.append(animateDouble())
        if points.count > 30 { points.removeFirst() }
    }

    private func animateDouble() -> Double {
        guard let first = points.last else { return 0 }
        var next = first + Double.random(in: -2.0...2.0)
        next = max(-8, min(8, next))
        return next
    }
}


#Preview {
    VStack(spacing: 8) {
        ClientsCard(value: "42%")
        StorageCard(value: "8 GB")
        LoadCard(value: "2%")
    }
    .padding(16)
    .background(LozaBackgroundView())
}
