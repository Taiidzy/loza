//
//  DashboardPieces.swift
//  Loza
//
//  Vivid dashboard card shell with glass effects and alive sparkline.
//

import SwiftUI

// MARK: - Card Shell (vivid)

struct DashboardCard<Content: View>: View {
    var icon: String? = nil
    var iconColor: Color = .accentColor
    var title: String
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if icon != nil || !title.isEmpty {
                HStack(spacing: 6) {
                    if let icon {
                        Image(systemName: icon)
                            .font(.system(size: 11))
                            .foregroundStyle(iconColor.opacity(0.8))
                    }
                    if !title.isEmpty {
                        Text(title)
                            .font(LozaType.subheadline)
                            .foregroundStyle(.white.opacity(0.88))
                    }
                }
                .padding(.bottom, 10)
            }
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .glassEffect(.regular, in: .rect(cornerRadius: LozaMetrics.cardRadius))
    }
}

// MARK: - Stat Card

struct StatCard: View {
    let label: String
    let value: String
    var color: Color = .white

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(LozaType.fieldLabel)
                .foregroundStyle(.white.opacity(0.38))
            Text(value)
                .font(LozaType.statNumber)
                .foregroundStyle(color.opacity(0.92))
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Card Skeleton

struct DashboardCardSkeleton: View {
    var body: some View {
        VStack(spacing: 8) {
            ForEach(0..<3, id: \.self) { _ in
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color.white.opacity(0.06))
                    .frame(height: 88)
            }
        }
    }
}

// MARK: - Sparkline (vivid)

struct Sparkline: View {
    var points: [Double]
    var color: Color = LozaColor.accentPink
    var lineWidth: CGFloat = 1.5

    var body: some View {
        Canvas { canvas, size in
            guard points.count > 1 else { return }

            let minY = points.min() ?? 0
            let maxY = points.max() ?? 1
            let rangeY = max(maxY - minY, 0.1)

            let w = size.width
            let h = size.height
            let step = w / CGFloat(points.count - 1)

            var path = Path()
            for (i, val) in points.enumerated() {
                let x = CGFloat(i) * step
                let y = h - (CGFloat(val - minY) / CGFloat(rangeY)) * h
                if i == 0 { path.move(to: CGPoint(x: x, y: y)) }
                else { path.addLine(to: CGPoint(x: x, y: y)) }
            }

            canvas.stroke(path, with: .color(color.opacity(0.7)), lineWidth: lineWidth)

            if let last = points.last {
                let x = w
                let y = h - (CGFloat(last - minY) / CGFloat(rangeY)) * h
                canvas.fill(
                    Path(ellipseIn: CGRect(x: x - 2, y: y - 2, width: 4, height: 4)),
                    with: .color(color)
                )
            }
        }
    }
}

// MARK: - Greeting Row

struct GreetingRow: View {
    let username: String
    var body: some View {
        let hour = Calendar.current.component(.hour, from: Date())
        let greeting: String
        if hour < 6 { greeting = "Доброй ночи" }
        else if hour < 12 { greeting = "Доброе утро" }
        else if hour < 17 { greeting = "Добрый день" }
        else { greeting = "Добрый вечер" }
        return VStack(alignment: .leading, spacing: 2) {
            Text("\(greeting), \(username)")
                .font(LozaType.title)
                .foregroundStyle(.white.opacity(0.88))
            Text("Ваши системы в норме")
                .font(LozaType.caption)
                .foregroundStyle(.white.opacity(0.42))
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Status Row

struct StatusRow: View {
    let icon: String
    let label: String
    let value: String

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 13))
                .foregroundStyle(.white.opacity(0.35))
                .frame(width: 20)
            Text(label)
                .font(LozaType.body)
                .foregroundStyle(.white.opacity(0.55))
            Spacer(minLength: 4)
            Text(value)
                .font(LozaType.subheadline)
                .foregroundStyle(.white.opacity(0.78))
                .multilineTextAlignment(.trailing)
        }
    }
}

// MARK: - Upcoming Row

struct UpcomingRow: View {
    let event: CalendarEvent
    var body: some View {
        let start = EventTime.start(date: event.startDate, time: event.startTime)
        return HStack(spacing: 6) {
            Circle().fill(event.color).frame(width: 6, height: 6)
            VStack(alignment: .leading, spacing: 1) {
                Text(event.title).font(LozaType.body).foregroundStyle(.white.opacity(0.88))
                Text(start.formatted(date: .abbreviated, time: .shortened))
                    .font(LozaType.fieldLabel).foregroundStyle(.white.opacity(0.42))
            }
            Spacer()
        }
    }
}
